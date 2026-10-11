import { Routes, Route, Navigate } from 'react-router-dom'
import { AdminLayout } from '@/app/layouts/AdminLayout'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { UsersPage } from '@/features/users/pages/UsersPage'
import { DevicesPage } from '@/features/users/pages/DevicesPage'
import { UserSubscriptionsPage } from '@/features/users/pages/UserSubscriptionsPage'
import { PlansPage } from '@/features/plans/pages/PlansPage'
import { SubscriptionsPage } from '@/features/subscriptions/pages/SubscriptionsPage'
import { ProxyConfigPage } from '@/features/proxy-config/pages/ProxyConfigPage'
import { AnnouncementsPage } from '@/features/announcements/pages/AnnouncementsPage'
import { ReleasesPage } from '@/features/releases/pages/ReleasesPage'
import { ReleaseUploadPage } from '@/features/releases/pages/ReleaseUploadPage'
import { FeedbackPage } from '@/features/feedback/pages/FeedbackPage'
import { SharedPlanBenefitsPage } from '@/features/shared-plan-benefits/pages/SharedPlanBenefitsPage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AdminLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/users" replace />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/users/:email/devices" element={<DevicesPage />} />
        <Route path="/users/:email/subscriptions" element={<UserSubscriptionsPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/proxy" element={<ProxyConfigPage />} />
        <Route path="/releases" element={<ReleasesPage />} />
        <Route path="/releases/new" element={<ReleaseUploadPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/shared-plan-benefits" element={<SharedPlanBenefitsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
