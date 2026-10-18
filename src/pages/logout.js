import { logout } from '../lib/auth.js';

export async function GET(context) {
  await logout(context);
  return context.redirect('/login');
}
