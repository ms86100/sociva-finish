const fs = require('fs');
const src = fs.readFileSync('supabase/functions/confirm-razorpay-payment/index.ts', 'utf8');
const auth = fs.readFileSync('supabase/functions/_shared/auth.ts', 'utf8');
const args = {
  project_id: 'kkzkuyhgdvyecmxtmkpy',
  name: 'confirm-razorpay-payment',
  entrypoint_path: 'functions/confirm-razorpay-payment/index.ts',
  verify_jwt: false,
  files: [
    { name: 'functions/confirm-razorpay-payment/index.ts', content: src },
    { name: 'functions/_shared/auth.ts', content: auth },
  ],
};
fs.writeFileSync('.tmp-fn-deploy/_mcp_min_deploy.json', JSON.stringify(args));
console.log('ok', src.length, !src.includes('PLACEHOLDER'), src.includes('Stamp checkout_group'));
