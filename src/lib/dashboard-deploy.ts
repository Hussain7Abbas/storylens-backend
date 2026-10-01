/** Repository whose `Deploy production` workflow listens for the backend's deploy event. */
export const DASHBOARD_REPOSITORY = 'Hussain7Abbas/storylens-dashboard';
export const BACKEND_DEPLOYED_EVENT = 'backend-deployed';

type DispatchDeps = {
  token?: string;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
};

export type DashboardDispatch = { status: 'unconfigured' } | { status: 'dispatched' };

/** Asks the dashboard repository to deploy its `main` branch after the backend has deployed. */
export const dispatchDashboardDeploy = async ({
  token,
  fetch: request = fetch,
}: DispatchDeps): Promise<DashboardDispatch> => {
  if (!token) return { status: 'unconfigured' };

  const response = await request(`https://api.github.com/repos/${DASHBOARD_REPOSITORY}/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'storylens-backend',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ event_type: BACKEND_DEPLOYED_EVENT }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Dashboard deploy dispatch failed with status ${response.status}: ${await response.text()}`);
  }

  return { status: 'dispatched' };
};
