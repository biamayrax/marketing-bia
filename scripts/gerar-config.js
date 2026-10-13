/* Gera public/js/config.js a partir das variáveis de ambiente da Vercel.
   Assim a URL e a chave do Supabase não ficam no repositório.
   Vercel > Project > Settings > Environment Variables: SUPABASE_URL e SUPABASE_ANON_KEY. */
const fs = require('fs');
const path = require('path');

const url = (process.env.SUPABASE_URL || '').trim();
const key = (process.env.SUPABASE_ANON_KEY || '').trim();

if (process.env.VERCEL && (!url || !key)) {
  console.error('\nFaltam as variáveis SUPABASE_URL e SUPABASE_ANON_KEY na Vercel.\n' +
    'Sem elas o site abriria em modo de demonstração, sem login. Configure e faça o deploy de novo.\n');
  process.exit(1);
}

const out = `/* Gerado automaticamente por scripts/gerar-config.js. Não edite. */
const SUPABASE_URL = ${JSON.stringify(url)};
const SUPABASE_ANON_KEY = ${JSON.stringify(key)};
`;
fs.writeFileSync(path.join(__dirname, '..', 'public', 'js', 'config.js'), out);
console.log(url ? 'config.js gerado (modo online).' : 'config.js gerado vazio (modo de demonstração local).');
