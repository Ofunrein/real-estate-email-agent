import { z } from "zod";

const ServerEnv = z.object({
  DEMO_ROOM_SECRET: z.string().min(32).optional(),
  OPENAI_API_KEY: z.string().min(20).optional(),
  VAPI_PUBLIC_KEY: z.string().min(10).optional(),
  VAPI_DEMO_ASSISTANT_ID: z.string().uuid().optional(),
  LUMENOSIS_TURSO_DATABASE_URL: z.string().min(10).optional(),
  LUMENOSIS_TURSO_AUTH_TOKEN: z.string().min(20).optional(),
  DEMO_DATA_SOURCE: z.string().optional(),
  DEMO_READ_DATABASE_URL: z.string().url().optional(),
  DEMO_WRITE_DATABASE_URL: z.string().url().optional(),
  LUMENOSIS_ADMIN_PASSWORD: z.string().min(4).optional(),
  LUMENOSIS_PLATFORM_API_SECRET: z.string().min(32).optional(),
  TAVILY_API_KEY: z.string().min(10).optional(),
  AGENTMAIL_API_KEY: z.string().min(10).optional(),
  FILLOUT_API_KEY: z.string().min(10).optional(),
  GHL_LOCATION_PIT: z.string().min(10).optional(),
  GHL_CALENDAR_ID: z.string().min(1).optional(),
  MAUTIC_BASE_URL: z.string().url().optional(),
  MAUTIC_USERNAME: z.string().min(1).optional(),
  MAUTIC_PASSWORD: z.string().min(1).optional(),
});

const ClientEnv = z.object({
  NEXT_PUBLIC_FILLOUT_FORM_ID: z.string().min(1).optional(),
  NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL: z.string().url().optional(),
});

export const serverEnv = ServerEnv.parse({
  DEMO_ROOM_SECRET: process.env.DEMO_ROOM_SECRET,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  VAPI_PUBLIC_KEY: process.env.VAPI_PUBLIC_KEY,
  VAPI_DEMO_ASSISTANT_ID: process.env.VAPI_DEMO_ASSISTANT_ID,
  LUMENOSIS_TURSO_DATABASE_URL: process.env.LUMENOSIS_TURSO_DATABASE_URL,
  LUMENOSIS_TURSO_AUTH_TOKEN: process.env.LUMENOSIS_TURSO_AUTH_TOKEN,
  DEMO_DATA_SOURCE: process.env.DEMO_DATA_SOURCE,
  DEMO_READ_DATABASE_URL: process.env.DEMO_READ_DATABASE_URL,
  DEMO_WRITE_DATABASE_URL: process.env.DEMO_WRITE_DATABASE_URL,
  LUMENOSIS_ADMIN_PASSWORD: process.env.LUMENOSIS_ADMIN_PASSWORD,
  LUMENOSIS_PLATFORM_API_SECRET: process.env.LUMENOSIS_PLATFORM_API_SECRET,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
  AGENTMAIL_API_KEY: process.env.AGENTMAIL_API_KEY,
  FILLOUT_API_KEY: process.env.FILLOUT_API_KEY,
  GHL_LOCATION_PIT: process.env.GHL_LOCATION_PIT,
  GHL_CALENDAR_ID: process.env.GHL_CALENDAR_ID,
  MAUTIC_BASE_URL: process.env.MAUTIC_BASE_URL,
  MAUTIC_USERNAME: process.env.MAUTIC_USERNAME,
  MAUTIC_PASSWORD: process.env.MAUTIC_PASSWORD,
});

export const clientEnv = ClientEnv.parse({
  NEXT_PUBLIC_FILLOUT_FORM_ID: process.env.NEXT_PUBLIC_FILLOUT_FORM_ID,
  NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL: process.env.NEXT_PUBLIC_GHL_CALENDAR_EMBED_URL,
});
