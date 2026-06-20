import { cookies } from 'next/headers';
import { AdminLogin } from '@/components/admin/admin-login';
import { AdminSidebar } from '@/components/admin/admin-sidebar';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('admin_session')?.value;
  const adminPassword = process.env.ADMIN_PASSWORD;

  const isAuthenticated = !!adminPassword && sessionCookie === adminPassword;

  if (!isAuthenticated) {
    return <AdminLogin />;
  }

  return (
    <div className="flex flex-col md:flex-row h-screen overflow-hidden bg-slate-950 text-slate-200">
      <AdminSidebar />
      <main className="flex-1 overflow-y-auto bg-slate-950/50 relative">
        {/* Subtle background glow */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="relative z-10 p-4 sm:p-8 max-w-7xl mx-auto min-h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
