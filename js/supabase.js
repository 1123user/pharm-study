/* 药学知识 · Supabase 配置
   部署前把下面两个值改成你自己的 Supabase 项目：
   - url     ：项目 URL（Settings → API → Project URL）
   - anonKey ：anon public key（Settings → API → anon public） */
window.SUPABASE_CONFIG = {
  url: "https://eaohjnqwxtowpmatvlln.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVhb2hqbnF3eHRvd3BtYXR2bGxuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk5NDQyNjYsImV4cCI6MjEwNTUyMDI2Nn0.A8TpvH00RZGKah3D8Yy4ByX1m--TG9m8MOW4yY6MeM0",
  // 登录邮箱后缀：账号 1248940427 会映射为 1248940427@pharm.app
  emailSuffix: "@pharm.app",
};
