'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { AdminUser, UserProviderConfig, PROVIDER_CATEGORIES } from '@/lib/types/admin';
import { ProviderConfigForm } from '@/components/admin/provider-config-form';
import { UserForm } from '@/components/admin/user-form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowLeft, User as UserIcon, Loader2, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';

import { PROVIDERS } from '@/lib/ai/providers';
import { IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { TTS_PROVIDERS, ASR_PROVIDERS } from '@/lib/audio/constants';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';

// Helper to get available providers for a category
const getAvailableProviders = (category: string) => {
  let sourceRecord: Record<string, { name: string }>;
  switch (category) {
    case 'llm': sourceRecord = PROVIDERS; break;
    case 'image': sourceRecord = IMAGE_PROVIDERS; break;
    case 'video': sourceRecord = VIDEO_PROVIDERS; break;
    case 'tts': sourceRecord = TTS_PROVIDERS; break;
    case 'asr': sourceRecord = ASR_PROVIDERS; break;
    case 'pdf': sourceRecord = PDF_PROVIDERS; break;
    case 'web_search': sourceRecord = WEB_SEARCH_PROVIDERS; break;
    default: return [];
  }
  return Object.entries(sourceRecord).map(([id, provider]) => ({
    id,
    name: provider.name,
  }));
};

export default function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  
  const [user, setUser] = useState<AdminUser | null>(null);
  const [configs, setConfigs] = useState<UserProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchUserAndConfigs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${id}`);
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        setConfigs(data.configs);
      } else {
        toast.error('Failed to load user');
        router.push('/admin/users');
      }
    } catch {
      toast.error('Failed to load user');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserAndConfigs();
  }, [id]);

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push('/admin/users')}
          className="text-slate-400 hover:text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{user.name}</h1>
          <p className="text-slate-400 text-sm">{user.email}</p>
        </div>
        <div className="ml-auto">
          <Button variant="outline" className="bg-white/5 border-white/10 text-white" onClick={fetchUserAndConfigs}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="bg-black/20 border border-white/10 p-1 rounded-xl w-full justify-start h-auto flex-wrap">
          <TabsTrigger 
            value="profile" 
            className="rounded-lg data-[state=active]:bg-violet-600 data-[state=active]:text-white text-slate-400 hover:text-slate-200"
          >
            <UserIcon className="h-4 w-4 mr-2" />
            Profile
          </TabsTrigger>
          {PROVIDER_CATEGORIES.map((cat) => (
            <TabsTrigger 
              key={cat.id} 
              value={cat.id}
              className="rounded-lg data-[state=active]:bg-violet-600 data-[state=active]:text-white text-slate-400 hover:text-slate-200"
            >
              {cat.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-6">
          <TabsContent value="profile">
            <Card className="p-6 bg-white/5 border-white/10 backdrop-blur-xl">
              <h2 className="text-lg font-semibold text-white mb-6">User Profile</h2>
              <div className="max-w-md">
                <UserForm 
                  initialData={user} 
                  onSuccess={(updatedUser) => setUser(updatedUser)} 
                  onCancel={() => router.push('/admin/users')} 
                />
              </div>
            </Card>
          </TabsContent>

          {PROVIDER_CATEGORIES.map((cat) => (
            <TabsContent key={cat.id} value={cat.id}>
              <div className="mb-6">
                <h2 className="text-lg font-semibold text-white">{cat.label} Configurations</h2>
                <p className="text-slate-400 text-sm mt-1">Configure {cat.label} providers and API keys specifically for {user.name}.</p>
              </div>
              <ProviderConfigForm
                userId={user.id}
                category={cat.id}
                configs={configs}
                availableProviders={getAvailableProviders(cat.id)}
                onSaved={fetchUserAndConfigs}
              />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </div>
  );
}
