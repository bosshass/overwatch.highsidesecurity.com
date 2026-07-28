// ============================================
// Jovelin — the signature stored in Settings, for any Gmail-compose feature
// ============================================
import { useState, useEffect } from 'react';
import { supabase } from '../services/supabase.js';

export function useSignature(userEmail) {
  const [signature, setSignature] = useState('');
  useEffect(() => {
    if (!userEmail) return;
    supabase.from('user_signatures').select('signature').eq('email', userEmail.toLowerCase()).maybeSingle()
      .then(({ data }) => setSignature(data?.signature || ''));
  }, [userEmail]);
  return signature;
}
