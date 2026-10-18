import { logout } from '../lib/auth.js';

export async function POST(context) {
  await logout(context);
  return context.redirect('/login', 303);
}
