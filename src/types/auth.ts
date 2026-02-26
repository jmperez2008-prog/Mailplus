
export interface User {
  id: string;
  username: string;
  password?: string; // Only for creation/updates, not returned in lists
  role: 'admin' | 'user';
  smtpConfig?: SMTPConfig;
  signature?: string;
}

export interface SMTPConfig {
  host: string;
  port: string;
  user: string;
  pass: string;
  from: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}
