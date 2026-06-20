'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Users, Settings, LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);

  const navItems = [
    { href: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
    { href: '/admin/users', label: 'Users', icon: Users, exact: false },
  ];

  const handleLogout = () => {
    // A simple way to log out is to clear the cookie. 
    // Since we don't have an API route for logout, we can just set an expired cookie
    document.cookie = 'admin_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    toast.success('Logged out');
    router.refresh();
  };

  return (
    <>
      {/* Mobile Nav Header */}
      <div className="md:hidden flex items-center justify-between p-4 border-b border-white/10 bg-slate-950 flex-shrink-0 z-20">
        <Link href="/admin" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
          <div className="h-8 w-8 bg-gradient-to-tr from-violet-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Settings className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-semibold text-white tracking-tight">AdminPanel</span>
        </Link>
        <Button variant="ghost" size="icon" onClick={() => setIsOpen(true)}>
          <Menu className="h-6 w-6 text-white" />
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isOpen && (
        <div 
          className="md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed md:static inset-y-0 left-0 z-50 w-64 flex-shrink-0 border-r border-white/10 bg-slate-950 md:bg-slate-950/50 backdrop-blur-xl flex flex-col h-full transition-transform duration-300 ease-in-out",
        isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-6 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-3" onClick={() => setIsOpen(false)}>
            <div className="h-8 w-8 bg-gradient-to-tr from-violet-600 to-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Settings className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-semibold text-white tracking-tight">AdminPanel</span>
          </Link>
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsOpen(false)}>
            <X className="h-5 w-5 text-slate-400" />
          </Button>
        </div>

        <div className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                  isActive
                    ? 'bg-violet-600/10 text-violet-400'
                    : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                )}
              >
                <item.icon className={cn('h-5 w-5', isActive ? 'text-violet-400' : 'text-slate-500')} />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-white/10">
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-400 hover:text-slate-200 hover:bg-white/5"
            onClick={() => {
              setIsOpen(false);
              handleLogout();
            }}
          >
            <LogOut className="h-5 w-5 mr-3 text-slate-500" />
            Logout
          </Button>
        </div>
      </aside>
    </>
  );
}
