// GET  /api/habits — 習慣マスター一覧
// POST /api/habits — 習慣マスター作成
import type { NextRequest } from "next/server";
import { handle, json, parseBody } from "@/lib/api";
import { db } from "@/lib/db";
import { createHabitSchema } from "@/lib/validation";

export function GET(): Promise<Response> {
  return handle(async () => {
    const { data, error } = await db
      .from("habits")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return json({ habits: data ?? [] });
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return handle(async () => {
    const parsed = await parseBody(req, createHabitSchema);
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const insert = {
      title: body.title,
      notes: body.notes ?? "",
      tags: body.tags ?? [],
      frequency_rule: body.frequency_rule,
      default_reminder_rule: body.default_reminder_rule ?? null,
      is_paused: body.is_paused ?? false,
      sort_order: body.sort_order ?? 0,
    };
    const { data, error } = await db.from("habits").insert(insert).select("*").single();
    if (error) throw new Error(error.message);
    return json({ habit: data }, 201);
  });
}
