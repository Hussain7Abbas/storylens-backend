import { describe, expect, it } from 'bun:test';
import { BACKEND_DEPLOYED_EVENT, DASHBOARD_REPOSITORY, dispatchDashboardDeploy } from '../src/lib/dashboard-deploy';

const recordingFetch = (status: number) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const request = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 204 ? null : 'Bad credentials', { status });
  };
  return { calls, request };
};

describe('dashboard deploy dispatch', () => {
  it('skips the request without a token', async () => {
    const { calls, request } = recordingFetch(204);
    expect(await dispatchDashboardDeploy({ token: undefined, fetch: request })).toEqual({ status: 'unconfigured' });
    expect(calls).toHaveLength(0);
  });

  it('sends the backend-deployed event to the dashboard repository', async () => {
    const { calls, request } = recordingFetch(204);
    expect(await dispatchDashboardDeploy({ token: 'token', fetch: request })).toEqual({ status: 'dispatched' });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe(`https://api.github.com/repos/${DASHBOARD_REPOSITORY}/dispatches`);
    expect(call?.init.method).toBe('POST');
    expect((call?.init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    expect(JSON.parse(String(call?.init.body))).toEqual({ event_type: BACKEND_DEPLOYED_EVENT });
  });

  it('fails when GitHub rejects the dispatch', async () => {
    const { request } = recordingFetch(401);
    await expect(dispatchDashboardDeploy({ token: 'expired', fetch: request })).rejects.toThrow('status 401: Bad credentials');
  });
});
