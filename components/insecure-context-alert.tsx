'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export function InsecureContextAlert() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState('');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Check if we are in an insecure context and not on localhost
    if (
      !window.isSecureContext &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setHost(window.location.host);
      setOpen(true);
    }
  }, []);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Akses Mikrofon Diblokir</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-4 pt-4 text-sm text-foreground">
              <p>
                Anda sedang mengakses aplikasi dari jaringan lokal ({host.split(':')[0]}) tanpa HTTPS. 
                Browser memblokir akses mikrofon untuk koneksi HTTP.
              </p>
              <div className="bg-muted p-4 rounded-md space-y-2">
                <p className="font-semibold text-foreground">Cara Melewati (Bypass) Keamanan Chrome:</p>
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground">
                  <li>Buka tab baru dan akses:<br/>
                    <code className="bg-background border px-1 py-0.5 rounded text-xs select-all text-primary block mt-1 break-all">
                      chrome://flags/#unsafely-treat-insecure-origin-as-secure
                    </code>
                  </li>
                  <li>Pada bagian <strong>Insecure origins treated as secure</strong>, masukkan:<br/>
                    <code className="bg-background border px-1 py-0.5 rounded text-xs select-all text-primary block mt-1">
                      http://{host}
                    </code>
                  </li>
                  <li>Ubah menu drop-down menjadi <strong>Enabled</strong>.</li>
                  <li>Klik tombol <strong>Relaunch</strong> di sudut kanan bawah.</li>
                </ol>
              </div>
              <div className="flex justify-end pt-2">
                <Button onClick={() => setOpen(false)}>Kembali</Button>
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>
  );
}
