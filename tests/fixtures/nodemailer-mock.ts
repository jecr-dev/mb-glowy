export const deliveries: Array<Record<string, unknown>> = [];
export let fail = false;
export function setFailure(value: boolean) { fail = value; }
export default {
  createTransport(_config: unknown) {
    return {
      async sendMail(message: Record<string, unknown>) {
        if (fail) throw Object.assign(new Error('private SMTP detail must never be logged'), { code: 'EAUTH' });
        deliveries.push(message);
        return { accepted: [message.to] };
      },
      close() {},
    };
  },
};
