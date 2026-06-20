'use client';

import { useState, useEffect } from 'react';
import { UserTable } from '@/components/admin/user-table';
import { UserForm } from '@/components/admin/user-form';
import { AdminUserWithStats } from '@/lib/types/admin';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Plus, Users, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUserWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
      } else {
        toast.error('Failed to load users');
      }
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  const handleUserAdded = (newUser: AdminUserWithStats) => {
    setUsers([newUser, ...users]);
    setShowAddModal(false);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 bg-violet-500/10 rounded-lg flex items-center justify-center flex-shrink-0">
            <Users className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">User Management</h1>
            <p className="text-slate-400 text-sm">Manage users and access control.</p>
          </div>
        </div>
        <Button 
          onClick={() => setShowAddModal(true)}
          className="bg-violet-600 hover:bg-violet-700 text-white sm:w-auto w-full"
        >
          <Plus className="mr-2 h-4 w-4" /> Add User
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <UserTable initialUsers={users} />
      </div>

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent className="sm:max-w-[425px] bg-slate-950 border-white/10 text-slate-200">
          <DialogHeader>
            <DialogTitle className="text-xl text-white">Add New User</DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            <UserForm 
              onSuccess={handleUserAdded} 
              onCancel={() => setShowAddModal(false)} 
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
