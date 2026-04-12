import { CanvaConfig, AutofillData, AutofillJobResponse, ExportJobResponse } from './types';
import { CANVA_DEFAULT_BASE_URL, CANVA_POLL_INTERVAL_MS, CANVA_MAX_POLL_ATTEMPTS } from './constants';
import { createLogger } from '@/lib/logger';

const log = createLogger('CanvaClient');

export class CanvaClient {
  private config: CanvaConfig;

  constructor(config: CanvaConfig) {
    this.config = {
      ...config,
      baseUrl: config.baseUrl || CANVA_DEFAULT_BASE_URL,
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    const headers = new Headers(options.headers);
    
    headers.set('Authorization', `Bearer ${this.config.token}`);
    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      let errorMsg = response.statusText;
      try {
        const errBody = await response.json();
        if (errBody.message) errorMsg = errBody.message;
        else if (errBody.error?.message) errorMsg = errBody.error.message;
      } catch (e) {
        // Ignored
      }
      throw new Error(`Canva API Error (${response.status}): ${errorMsg}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test if the Canva connection is valid
   * Uses the /v1/users/me endpoint
   */
  async verifyConnection(): Promise<boolean> {
    try {
      await this.request('/v1/users/me');
      return true;
    } catch (error) {
      log.error('Connection verification failed:', error);
      return false;
    }
  }

  /**
   * Step 1: Start Autofill Job
   */
  async startAutofillJob(title: string, data: AutofillData): Promise<string> {
    log.info(`Starting autofill job for template ${this.config.brandTemplateId}`);
    const res = await this.request<AutofillJobResponse>('/v1/autofills', {
      method: 'POST',
      body: JSON.stringify({
        brand_template_id: this.config.brandTemplateId,
        title,
        data,
      }),
    });
    return res.job.id;
  }

  /**
   * Step 2: Poll Autofill Job
   */
  async pollAutofillJob(jobId: string): Promise<string> {
    log.info(`Polling autofill job ${jobId}`);
    let attempts = 0;

    while (attempts < CANVA_MAX_POLL_ATTEMPTS) {
      const res = await this.request<AutofillJobResponse>(`/v1/autofills/${jobId}`);
      if (res.job.status === 'success' && res.job.result?.design?.id) {
        return res.job.result.design.id;
      } else if (res.job.status === 'failed') {
        throw new Error(res.job.error?.message || 'Autofill job failed');
      }

      // 'in_progress', wait and poll again
      await new Promise((resolve) => setTimeout(resolve, CANVA_POLL_INTERVAL_MS));
      attempts++;
    }

    throw new Error('Autofill job timed out');
  }

  /**
   * Step 3: Start Export Job
   */
  async startExportJob(designId: string): Promise<string> {
    log.info(`Starting export job for design ${designId}`);
    const formatType = this.config.exportFormat || 'png';
    const res = await this.request<ExportJobResponse>('/v1/exports', {
      method: 'POST',
      body: JSON.stringify({
        design_id: designId,
        format: {
          type: formatType,
        },
      }),
    });
    return res.job.id;
  }

  /**
   * Step 4: Poll Export Job
   */
  async pollExportJob(jobId: string): Promise<string[]> {
    log.info(`Polling export job ${jobId}`);
    let attempts = 0;

    while (attempts < CANVA_MAX_POLL_ATTEMPTS) {
      const res = await this.request<ExportJobResponse>(`/v1/exports/${jobId}`);
      if (res.job.status === 'success' && res.job.urls?.length > 0) {
        return res.job.urls;
      } else if (res.job.status === 'failed') {
        throw new Error(res.job.error?.message || 'Export job failed');
      }

      await new Promise((resolve) => setTimeout(resolve, CANVA_POLL_INTERVAL_MS));
      attempts++;
    }

    throw new Error('Export job timed out');
  }

  /**
   * Full Convenience Method: Autofill -> Poll -> Export -> Poll
   */
  async generateDesignImage(title: string, data: AutofillData): Promise<string[]> {
    const autofillJobId = await this.startAutofillJob(title, data);
    const designId = await this.pollAutofillJob(autofillJobId);
    
    const exportJobId = await this.startExportJob(designId);
    const exportUrls = await this.pollExportJob(exportJobId);

    return exportUrls;
  }
}
