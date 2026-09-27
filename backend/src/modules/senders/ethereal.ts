import nodemailer from 'nodemailer';

export interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
}

/** Creates Ethereal test inboxes; injected so tests never call the real Ethereal API. */
export interface EtherealAccountProvider {
  createAccount(): Promise<EtherealAccount>;
}

export const etherealAccountProvider: EtherealAccountProvider = {
  async createAccount() {
    const account = await nodemailer.createTestAccount();
    return {
      user: account.user,
      pass: account.pass,
      smtp: { host: account.smtp.host, port: account.smtp.port, secure: account.smtp.secure },
    };
  },
};
