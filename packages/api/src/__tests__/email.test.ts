import nodemailer from 'nodemailer';
import {
  sendBookingConfirmation,
  sendBookingCancellation,
  setTransport,
  resetTransport,
  EmailUser,
  EmailBooking,
  EmailDesk,
  EmailFloor,
} from '../services/email';

jest.mock('nodemailer');

const mockSendMail = jest.fn();
const mockCreateTransport = nodemailer.createTransport as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetTransport();
  mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
  mockSendMail.mockResolvedValue({ messageId: 'test-id' });
});

const user: EmailUser = { id: 'u1', email: 'alice@example.com', name: 'Alice' };
const booking: EmailBooking = { id: 'b1', date: '2024-06-01', start_time: '09:00', end_time: '10:00' };
const desk: EmailDesk = { id: 'd1', label: 'A-01' };
const floor: EmailFloor = { id: 'f1', name: 'Ground Floor', building: 'HQ' };

describe('sendBookingConfirmation', () => {
  test('calls sendMail with correct recipient and subject', async () => {
    await sendBookingConfirmation(user, booking, desk, floor);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('alice@example.com');
    expect(mail.subject).toContain('A-01');
    expect(mail.subject).toContain('2024-06-01');
    expect(mail.subject).toContain('confirmed');
  });

  test('email body contains booking details', async () => {
    await sendBookingConfirmation(user, booking, desk, floor);

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.text).toContain('Alice');
    expect(mail.text).toContain('A-01');
    expect(mail.text).toContain('Ground Floor');
    expect(mail.text).toContain('HQ');
    expect(mail.text).toContain('2024-06-01');
    expect(mail.text).toContain('09:00');
    expect(mail.text).toContain('10:00');
  });

  test('does not throw when sendMail fails (non-blocking)', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP error'));
    await expect(sendBookingConfirmation(user, booking, desk, floor)).resolves.toBeUndefined();
  });
});

describe('sendBookingCancellation', () => {
  test('calls sendMail with correct recipient and subject', async () => {
    await sendBookingCancellation(user, booking, desk, floor);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.to).toBe('alice@example.com');
    expect(mail.subject).toContain('A-01');
    expect(mail.subject).toContain('2024-06-01');
    expect(mail.subject).toContain('cancelled');
  });

  test('email body contains cancellation details', async () => {
    await sendBookingCancellation(user, booking, desk, floor);

    const mail = mockSendMail.mock.calls[0][0];
    expect(mail.text).toContain('Alice');
    expect(mail.text).toContain('A-01');
    expect(mail.text).toContain('Ground Floor');
    expect(mail.text).toContain('HQ');
    expect(mail.text).toContain('2024-06-01');
    expect(mail.text).toContain('now available');
  });

  test('does not throw when sendMail fails (non-blocking)', async () => {
    mockSendMail.mockRejectedValue(new Error('SMTP error'));
    await expect(sendBookingCancellation(user, booking, desk, floor)).resolves.toBeUndefined();
  });
});

describe('transport selection', () => {
  test('uses jsonTransport when SMTP_HOST is not set', () => {
    delete process.env.SMTP_HOST;
    resetTransport();
    // Trigger transport creation
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    sendBookingConfirmation(user, booking, desk, floor);
    expect(mockCreateTransport).toHaveBeenCalledWith({ jsonTransport: true });
  });

  test('uses SMTP transport when SMTP_HOST is set', () => {
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'user@example.com';
    process.env.SMTP_PASS = 'secret';
    resetTransport();
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    sendBookingConfirmation(user, booking, desk, floor);
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.example.com', port: 465 })
    );
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  test('setTransport allows injecting a custom transport', async () => {
    const customSendMail = jest.fn().mockResolvedValue({});
    setTransport({ sendMail: customSendMail } as unknown as ReturnType<typeof nodemailer.createTransport>);
    await sendBookingConfirmation(user, booking, desk, floor);
    expect(customSendMail).toHaveBeenCalledTimes(1);
    expect(mockCreateTransport).not.toHaveBeenCalled();
  });
});
