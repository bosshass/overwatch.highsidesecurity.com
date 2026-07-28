// ============================================
// Jovelin — Public legal pages (Terms, Privacy)
// ============================================
// Reachable at /terms and /privacy WITHOUT signing in — checked before any
// auth gate in App.jsx. Exists specifically so these have a real, live,
// publicly-clickable URL to submit as part of Intuit's app assessment,
// not just a downloadable document nobody outside the team could open.
const TEAL = '#0D4F5C', TEXT = '#1c1c1e', SUBTEXT = '#6b7787', BORDER = '#e5e9eb';

const wrap = { background: '#f7f9fa', minHeight: '100vh', padding: '40px 20px', fontFamily: 'Georgia, serif', color: TEXT };
const inner = { maxWidth: 720, margin: '0 auto', background: '#fff', border: `1px solid ${BORDER}`, borderRadius: 14, padding: '40px 48px' };
const h1 = { color: TEAL, fontSize: 26, fontWeight: 700, marginBottom: 4 };
const sub = { color: SUBTEXT, fontSize: 14, marginBottom: 24, fontStyle: 'italic' };
const h2 = { color: TEAL, fontSize: 17, fontWeight: 700, marginTop: 28, marginBottom: 8 };
const p = { fontSize: 14, lineHeight: 1.7, marginBottom: 14 };
const draftBox = { border: '1px solid #B45309', background: '#FFFBEB', color: '#92400E', borderRadius: 8, padding: '14px 18px', fontSize: 13, fontStyle: 'italic', marginBottom: 24 };
const nav = { display: 'flex', gap: 16, marginBottom: 24, fontSize: 13 };

function Nav({ current }) {
  return (
    <div style={nav}>
      <a href="/terms" style={{ color: current === 'terms' ? TEAL : SUBTEXT, fontWeight: current === 'terms' ? 700 : 400 }}>Terms of Service</a>
      <a href="/privacy" style={{ color: current === 'privacy' ? TEAL : SUBTEXT, fontWeight: current === 'privacy' ? 700 : 400 }}>Privacy Policy</a>
    </div>
  );
}

export function TermsPage() {
  return (
    <div style={wrap}><div style={inner}>
      <Nav current="terms" />
      <div style={h1}>Jovelin Terms of Service</div>
      <div style={sub}>A platform of JNB LLC d/b/a Second Gear Advisors — Last updated: [DATE]</div>
      <div style={draftBox}>DRAFT — NOT FINAL. Covers the areas QuickBooks Online's app review typically expects an integrating application to address. Has not been reviewed by an attorney and should be finalized by one, including confirming state of formation and applicable law, before relying on it.</div>

      <div style={h2}>1. Acceptance of Terms</div>
      <p style={p}>This Terms of Service Agreement ("Agreement") is entered into between JNB LLC, a [STATE] limited liability company doing business as Second Gear Advisors ("Company," "we," "us"), and the business or individual accessing or using the Jovelin platform ("Client," "you"). By creating an account, connecting a QuickBooks Online company, or otherwise using Jovelin, you agree to be bound by this Agreement.</p>

      <div style={h2}>2. Description of Service</div>
      <p style={p}>Jovelin is a multi-tenant field-service and financial-operations platform provided by Company. Jovelin allows Client to track jobs and tasks, log time, build and manage estimates, and view financial information sourced from Client's own QuickBooks Online company.</p>

      <div style={h2}>3. QuickBooks Online Integration</div>
      <p style={p}>Jovelin integrates with QuickBooks Online ("QBO") through Intuit's official API, using the OAuth 2.0 authorization protocol. This section governs that integration specifically.</p>
      <p style={p}><b>3.1 Authorization.</b> Client authorizes this integration by connecting a QBO company to Jovelin through Intuit's own sign-in and consent screen. Company never receives or stores Client's QBO username or password.</p>
      <p style={p}><b>3.2 Data Accessed.</b> Once connected, Jovelin reads and, where Client takes an explicit action to do so, writes the following QBO data on Client's behalf: customer records, products and services (items), invoices, estimates, payments, and related financial reports. Jovelin does not access QBO data beyond what is reasonably necessary to provide the features Client uses.</p>
      <p style={p}><b>3.3 No Automatic Communications Through QuickBooks.</b> Jovelin does not use QuickBooks Online's own email-sending features to contact Client's customers. Any invoice or estimate created in QBO through Jovelin is created in an unsent state. Where Jovelin facilitates sending a communication to a customer, that communication is composed for Client's own review and sent by Client through Client's own email account — never sent automatically by Company or by QuickBooks on Client's behalf.</p>
      <p style={p}><b>3.4 Token Storage and Security.</b> Company stores only the encrypted OAuth access and refresh tokens issued by Intuit for Client's connected company, not Client's QBO credentials. These tokens are used solely to make authorized API calls to QBO on Client's behalf and are transmitted and stored using industry-standard encryption.</p>
      <p style={p}><b>3.5 Revoking Access.</b> Client may disconnect Jovelin's access to its QBO company at any time, either from within Jovelin or directly from QuickBooks Online's own connected-apps management screen. Disconnection takes effect immediately for all future API calls.</p>
      <p style={p}><b>3.6 Accuracy of QBO Data.</b> Jovelin displays and computes financial information based on data retrieved from Client's QBO company. Company is not responsible for the accuracy of the underlying data in Client's QuickBooks Online company, which remains Client's sole responsibility.</p>
      <p style={p}><b>3.7 Intuit Is Not a Party.</b> Intuit Inc. is not a party to this Agreement and has no liability of any kind arising out of Client's use of Jovelin. Client's use of QuickBooks Online itself remains governed by Client's own agreement with Intuit.</p>

      <div style={h2}>4. Client Accounts and Users</div>
      <p style={p}>Client may invite additional users to its Jovelin account subject to any seat limits Company has established for Client's account. Client is responsible for maintaining the confidentiality of login credentials for all users on its account and for all activity that occurs under those accounts.</p>

      <div style={h2}>5. Data Privacy and Security</div>
      <p style={p}>Company will use commercially reasonable administrative, technical, and physical safeguards designed to protect Client data, including data retrieved from QBO, against unauthorized access, disclosure, or destruction. Company will not sell Client data or QBO data to third parties. A more complete description of data handling is set out in Company's <a href="/privacy" style={{ color: TEAL }}>Privacy Policy</a>, which is incorporated into this Agreement by reference.</p>

      <div style={h2}>6. Fees and Payment</div>
      <p style={p}>[Fee structure, billing cycle, and payment terms to be inserted based on Company's actual pricing model — e.g., per-tenant subscription, seat-based pricing, or a services retainer.]</p>

      <div style={h2}>7. Intellectual Property</div>
      <p style={p}>The Jovelin platform, including its software, design, and underlying architecture, is and remains the property of Company. This Agreement grants Client a limited, non-exclusive, non-transferable right to access and use Jovelin for its own internal business purposes for the term of this Agreement. Client retains all rights to its own data, including data synced from its QBO company.</p>

      <div style={h2}>8. Warranty Disclaimer</div>
      <p style={p}>JOVELIN IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.</p>

      <div style={h2}>9. Limitation of Liability</div>
      <p style={p}>TO THE MAXIMUM EXTENT PERMITTED BY LAW, COMPANY'S TOTAL LIABILITY ARISING OUT OF OR RELATED TO THIS AGREEMENT WILL NOT EXCEED THE FEES PAID BY CLIENT TO COMPANY IN THE TWELVE (12) MONTHS PRECEDING THE CLAIM. COMPANY WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES.</p>

      <div style={h2}>10. Termination</div>
      <p style={p}>Either party may terminate this Agreement [on 30 days' written notice / per the terms of Client's specific engagement letter]. Upon termination, Client's QBO connection will be disconnected and Client's access to Jovelin will end. Company will make Client's own data available for export for a period of 30 days following termination.</p>

      <div style={h2}>11. Governing Law</div>
      <p style={p}>This Agreement is governed by the laws of the State of [STATE], without regard to its conflict-of-laws principles.</p>

      <div style={h2}>12. Contact</div>
      <p style={p}>Questions about this Agreement or the QuickBooks Online integration described in Section 3 may be directed to [CONTACT EMAIL].</p>
    </div></div>
  );
}

export function PrivacyPage() {
  return (
    <div style={wrap}><div style={inner}>
      <Nav current="privacy" />
      <div style={h1}>Jovelin Privacy Policy</div>
      <div style={sub}>A platform of JNB LLC d/b/a Second Gear Advisors — Last updated: [DATE]</div>
      <div style={draftBox}>DRAFT — NOT FINAL. Has not been reviewed by an attorney and should be finalized by one before being relied on for Intuit's app assessment or presented to any client.</div>

      <div style={h2}>1. Scope</div>
      <p style={p}>This Privacy Policy describes how JNB LLC d/b/a Second Gear Advisors ("Company," "we," "us") collects, uses, and protects information in connection with the Jovelin platform ("Jovelin"), including information Jovelin accesses from a Client's connected QuickBooks Online ("QBO") company.</p>

      <div style={h2}>2. Information We Collect</div>
      <p style={p}><b>2.1 Account Information.</b> Name, email address, and login credentials for each user Client adds to its Jovelin account.</p>
      <p style={p}><b>2.2 QuickBooks Online Data.</b> With Client's authorization via Intuit's OAuth consent screen, Jovelin accesses: customer records, products and services (items) and their pricing, invoices, estimates, payments, and related financial reports from Client's connected QBO company. Jovelin does not receive or store Client's QBO login credentials — only encrypted OAuth tokens issued by Intuit.</p>
      <p style={p}><b>2.3 Operational Data.</b> Information Client enters directly into Jovelin, including tasks, jobs, time entries, and estimate details.</p>

      <div style={h2}>3. How We Use Information</div>
      <p style={p}>Information is used solely to provide, maintain, and improve the Jovelin platform for Client — including displaying financial data, computing job costs and revenue, and enabling the features Client actively uses. We do not sell Client data, including data retrieved from QBO, to third parties, and do not use it for advertising.</p>

      <div style={h2}>4. Data Sharing</div>
      <p style={p}>We do not share Client data with third parties except: (a) service providers who help operate Jovelin's infrastructure (e.g., hosting and database providers), under obligations of confidentiality; (b) as required by law; or (c) with Client's explicit direction (for example, when Client sends a communication to its own customer through Jovelin).</p>

      <div style={h2}>5. Data Security</div>
      <p style={p}>OAuth tokens and other sensitive data are encrypted in storage and in transit. Access to Client data within Company is limited to what is necessary to operate and support the platform.</p>

      <div style={h2}>6. Data Retention</div>
      <p style={p}>Client data, including QBO-sourced data cached within Jovelin, is retained for as long as Client's account remains active. Upon termination of service, Client data will be made available for export for a period of 30 days, after which it may be deleted from Company's systems.</p>

      <div style={h2}>7. Client Control</div>
      <p style={p}>Client may disconnect Jovelin's access to its QBO company at any time, either within Jovelin or directly through QuickBooks Online's own connected-apps management. Client may also request deletion of its account data by contacting Company.</p>

      <div style={h2}>8. Children's Privacy</div>
      <p style={p}>Jovelin is a business-to-business platform and is not directed to, and does not knowingly collect information from, individuals under 18.</p>

      <div style={h2}>9. Changes to This Policy</div>
      <p style={p}>We may update this Privacy Policy from time to time. Material changes will be reflected by an updated "Last updated" date above.</p>

      <div style={h2}>10. Contact</div>
      <p style={p}>Questions about this Privacy Policy or how Jovelin handles QuickBooks Online data may be directed to [CONTACT EMAIL].</p>
    </div></div>
  );
}
