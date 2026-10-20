import { NextResponse } from 'next/server';
import { checkAccount, type Account } from '@/lib/accounts';
import { accountIdFromCookie } from '@/lib/auth';
import { SESSION_COOKIE, checkRateLimit, sessionFromCookieHeader, signSession, checkPassword, clearRateLimit, isPasswordConfigured } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isPasswordConfigured()) {
    return NextResponse.json(
      { success: false, error: '服务器未设置 PASSWORD 环境变量，请联系管理员配置' },
      { status: 503 }
    );
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { success: false, error: '尝试次数过多，请 10 分钟后再试' },
      { status: 429 }
    );
  }

  const origin = req.headers.get('origin');
  const host = req.headers.get('host') || new URL(req.url).host;
  try {
    if (req.headers.get('sec-fetch-site') === 'cross-site' || (origin && new URL(origin).host !== host)) return NextResponse.json({ error: '不接受跨站登录' }, { status: 403 });
  } catch { return NextResponse.json({ error: '无效的来源' }, { status: 403 }); }
  let password = '';
  let username = '';
  try {
    const body = (await req.json()) as { password?: string; username?: string };
    if (typeof body.password !== 'string' || body.password.length > 256 || (body.username !== undefined && typeof body.username !== 'string')) throw new Error('Invalid credentials');
    password = body.password;
    username = (body.username || '').trim().toLowerCase();
    if (username && !/^[a-z0-9_-]{1,32}$/.test(username)) throw new Error('Invalid username');
  } catch {
    return NextResponse.json({ success: false, error: '请求格式错误' }, { status: 400 });
  }

  if (username && !checkRateLimit(`account:${username}`)) return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429 });
  let account: Account | null = null;
  try { if (username) account = await checkAccount(username, password); }
  catch { return NextResponse.json({ error: '账号服务暂时不可用' }, { status: 503 }); }
  if (username ? !account : !checkPassword(password)) {
    return NextResponse.json({ success: false, error: '用户名或密码错误' }, { status: 401 });
  }

  clearRateLimit(ip);
  if (username) clearRateLimit(`account:${username}`);
  const { token, expiresAt } = signSession(account || undefined);
  const res = NextResponse.json({ success: true, accountId: account?.id || null });
  // Cookie Secure 策略：COOKIE_SECURE 环境变量显式覆盖；否则按 x-forwarded-proto 推导。
  // 不能依赖 req.url——Next.js Route Handler 中它是内部转发地址，并非用户侧的原始协议。
  const secure = process.env.COOKIE_SECURE === 'true'
    ? true
    : process.env.COOKIE_SECURE === 'false'
      ? false
      : (req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? 'http') === 'https';
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: Math.floor((expiresAt - Date.now()) / 1000),
    path: '/',
  });
  return res;
}

/** GET：查询当前会话状态 */
export async function GET(req: Request) {
  const verified = sessionFromCookieHeader(req.headers.get('cookie'));
  return NextResponse.json({ success: true, verified, accountId: verified ? accountIdFromCookie(req.headers.get('cookie')) : null });
}

/** DELETE：登出 */
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
  return res;
}
