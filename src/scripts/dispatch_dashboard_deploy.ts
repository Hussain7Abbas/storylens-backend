import { env } from '@/env';
import { DASHBOARD_REPOSITORY, dispatchDashboardDeploy } from '@/lib/dashboard-deploy';

/**
 * Triggers the dashboard's deploy workflow. The review-version watcher runs it after `make sync` succeeds.
 * Usage: make notify-dashboard
 */
const result = await dispatchDashboardDeploy({ token: env.DASHBOARD_DISPATCH_TOKEN });

if (result.status === 'unconfigured') {
  console.warn('DASHBOARD_DISPATCH_TOKEN is not set; the dashboard was not deployed');
} else {
  console.log(`Requested a ${DASHBOARD_REPOSITORY} deploy`);
}
