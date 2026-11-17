declare module "web-push" {
  type Subscription = { endpoint: string; expirationTime?: number | null; keys: { p256dh: string; auth: string } };
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(subscription: Subscription, payload: string, options?: { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high" }): Promise<unknown>;
}