import { describe, expect, it } from 'vitest';
import { smtpTransportOptions } from './mailer.ts';

describe('smtpTransportOptions', () => {
  it('sends no credentials to a relay that accepts the server by its address', () => {
    const options = smtpTransportOptions({
      host: 'smtp-relay.gmail.com',
      port: 587,
      from: 'Potencializador <no-reply@example.com>',
      clientName: 'potencializador.example.com',
    });

    expect(options).toEqual({
      host: 'smtp-relay.gmail.com',
      port: 587,
      secure: false,
      requireTLS: true,
      // Google's relay refuses a greeting that is not a full domain name, such as a container id.
      name: 'potencializador.example.com',
    });
  });

  it('signs in with the account when there are credentials, with TLS from the start on port 465', () => {
    const options = smtpTransportOptions({
      host: 'smtp.gmail.com',
      port: 465,
      auth: { user: 'no-reply@example.com', password: 'app-password' },
      from: 'Potencializador <no-reply@example.com>',
      clientName: 'potencializador.example.com',
    });

    expect(options).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      requireTLS: false,
      name: 'potencializador.example.com',
      auth: { user: 'no-reply@example.com', pass: 'app-password' },
    });
  });
});
