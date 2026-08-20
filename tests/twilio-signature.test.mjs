import crypto from 'node:crypto';

// Twilio's OWN documented worked example, quoted verbatim from
// twilio.com/docs/usage/security:
//
//   hmac_sha1(https://example.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDE
//             Caller+14158675310Digits1234From+14158675310To+18005551212, 12345)
//   -> L/OH5YylLD5NRKLltdqwSvS0BnU=
const TOKEN = '12345';
const URL_  = 'https://example.com/myapp.php?foo=1&bar=2';
const PARAMS = {
  To: '+18005551212',
  From: '+14158675310',
  Digits: '1234',
  Caller: '+14158675310',
  CallSid: 'CA1234567890ABCDE',
};
const EXPECTED = 'L/OH5YylLD5NRKLltdqwSvS0BnU=';

// --- the exact function from api/sms-inbound.js ---
function signatureFor(token, url, params) {
  let data = url;
  for (const k of Object.keys(params).sort()) data += k + params[k];
  return crypto.createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
}
function sameSig(a, b) {
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

let pass = 0, fail = 0;
const t = (name, cond) => cond ? (pass++, console.log('  ok   ' + name)) : (fail++, console.log('  FAIL ' + name));

const got = signatureFor(TOKEN, URL_, PARAMS);
t(`matches Twilio's published value (${got})`, got === EXPECTED);

// The concatenated string itself, against the one the docs print.
let data = URL_;
for (const k of Object.keys(PARAMS).sort()) data += k + PARAMS[k];
t('concatenation matches the documented string',
  data === 'https://example.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212');

// Insertion order must not matter — only alphabetical key order.
const shuffled = { Digits:'1234', CallSid:'CA1234567890ABCDE', To:'+18005551212', Caller:'+14158675310', From:'+14158675310' };
t('insertion order is irrelevant', signatureFor(TOKEN, URL_, shuffled) === EXPECTED);

// A wrong URL must not validate — this is the whole point.
t('wrong URL rejected', signatureFor(TOKEN, 'http://invalid.com', PARAMS) !== EXPECTED);
// Trailing slash is a DIFFERENT string, which is why candidateUrls tries both.
t('trailing slash is a different signature', signatureFor(TOKEN, URL_ + '/', PARAMS) !== EXPECTED);
// Wrong token must not validate.
t('wrong auth token rejected', signatureFor('54321', URL_, PARAMS) !== EXPECTED);
// A dropped parameter must not validate.
const { Digits, ...missing } = PARAMS;
t('missing parameter rejected', signatureFor(TOKEN, URL_, missing) !== EXPECTED);

// Constant-time compare behaves on equal and unequal lengths.
t('sameSig true on match', sameSig(EXPECTED, EXPECTED));
t('sameSig false on mismatch', !sameSig(EXPECTED, 'AAAA'));
t('sameSig false on empty', !sameSig(EXPECTED, ''));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
