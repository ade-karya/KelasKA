export interface CanvaConfig {
  token: string;
  baseUrl?: string;
  brandTemplateId: string;
  exportFormat?: 'png' | 'jpg';
}

export interface AutofillData {
  [key: string]: {
    type: 'text' | 'image';
    text?: string;
    asset_id?: string;
  };
}

export interface AutofillJobResponse {
  job: {
    id: string;
    status: 'in_progress' | 'success' | 'failed';
    result?: {
      type: 'design';
      design: {
        id: string;
        title: string;
        url: string;
      };
    };
    error?: {
      code: string;
      message: string;
    };
  };
}

export interface ExportJobResponse {
  job: {
    id: string;
    status: 'in_progress' | 'success' | 'failed';
    urls: string[];
    error?: {
      code: string;
      message: string;
    };
  };
}
