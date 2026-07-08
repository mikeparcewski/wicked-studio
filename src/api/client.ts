const BASE = 'http://127.0.0.1:7701/api/v1';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one — Fastify v5 rejects
  // an empty body with Content-Type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which would 400 every bodyless POST (approve / reject).
  const headers = init?.body !== undefined && init?.body !== null
    ? { 'Content-Type': 'application/json', ...init?.headers }
    : { ...init?.headers };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  listSessions: () => apiFetch<{ sessions: { session: Session; phases: Phase[] }[] }>('/sessions'),
  getSession: (id: string) => apiFetch<{ session: Session; phases: Phase[] }>(`/sessions/${id}`),
  approveGate: (sessionId: string, phaseId: string) =>
    apiFetch(`/sessions/${sessionId}/gates/${phaseId}/approve`, { method: 'POST' }),
  rejectGate: (sessionId: string, phaseId: string) =>
    apiFetch(`/sessions/${sessionId}/gates/${phaseId}/reject`, { method: 'POST' }),
  approveWithConditions: (sessionId: string, phaseId: string, conditions: string) =>
    apiFetch(`/sessions/${sessionId}/gates/${phaseId}/approve-with-conditions`, {
      method: 'POST',
      body: JSON.stringify({ conditions }),
    }),
  getWorkers: () => apiFetch<{ workers: Worker[] }>('/workers'),
  getHealth: () => apiFetch<{ status: string; version: string }>('/health'),
};

export interface Session {
  id: string;
  type: string;
  goal: string;
  status: string;
  workers: string[];
  created_at: string;
  updated_at: string;
}

export interface Phase {
  id: string;
  session_id: string;
  phase_id: string;
  state: string;
  gate_kind: string;
  blocking_raid_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Worker {
  id: string;
  command: string;
  args: string[];
}
