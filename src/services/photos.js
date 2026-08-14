// ============================================================================
// photos.js — job photos, stored in Supabase Storage.
//
// There was already a "photoLink" box on the finish sheet: a text field where
// a tech was expected to upload a picture SOMEWHERE ELSE, copy the URL, and
// paste it in. Nobody did that, which is why photos live in people's phones
// and in texts instead of on the job.
//
// This is free — Storage is part of the Supabase project already. No Twilio,
// no per-message charge, and unlike a text the photo ends up attached to the
// visit, so it is still findable six months later when the invoice is queried.
//
// BUCKET: create once, in the Supabase dashboard → Storage → New bucket
//   name: job-photos
//   public: yes (URLs are unguessable; nothing here is sensitive)
// ============================================================================

import { supabase } from './supabase.js';

const BUCKET = 'job-photos';

// Phone cameras produce 3–8MB files and a tech is often on one bar of LTE.
// Downscaling before upload is the difference between "it worked" and "it
// spun and he gave up".
const MAX_EDGE = 1600;
const QUALITY = 0.72;

async function shrink(file) {
  if (!file.type.startsWith('image/')) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900_000) return file;

    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', QUALITY));
    return blob && blob.size < file.size
      ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
      : file;
  } catch {
    return file;   // never block an upload over a resize
  }
}

// Returns { ok, url } or { ok:false, error }.
export async function uploadPhoto(file, { customerCode = 'misc' } = {}) {
  try {
    const small = await shrink(file);
    const stamp = new Date().toISOString().slice(0, 10);
    const rand = Math.random().toString(36).slice(2, 8);
    const ext = (small.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${customerCode}/${stamp}-${rand}.${ext}`;

    const { error } = await supabase.storage.from(BUCKET)
      .upload(path, small, { cacheControl: '31536000', upsert: false });
    if (error) return { ok: false, error: error.message };

    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (e) {
    return { ok: false, error: e.message || 'Upload failed' };
  }
}

export async function uploadPhotos(files, opts) {
  const out = [];
  for (const f of files) {
    const r = await uploadPhoto(f, opts);
    out.push(r);
  }
  return out;
}
