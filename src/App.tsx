import { Routes, Route, Navigate } from 'react-router-dom'
import { AdminLayout } from '@/app/layouts/AdminLayout'
import { RequireAuth } from '@/features/auth/RequireAuth'
import { LoginPage } from '@/features/auth/pages/LoginPage'
import { UsersPage } from '@/features/users/pages/UsersPage'
import { PlansPage } from '@/features/plans/pages/PlansPage'
import { ProxyConfigPage } from '@/features/proxy-config/pages/ProxyConfigPage'
import { AnnouncementsPage } from '@/features/announcements/pages/AnnouncementsPage'
import { ReleasesPage } from '@/features/releases/pages/ReleasesPage'
import { ReleaseUploadPage } from '@/features/releases/pages/ReleaseUploadPage'
import { FeedbackPage } from '@/features/feedback/pages/FeedbackPage'
import { SharedPlanBenefitsPage } from '@/features/shared-plan-benefits/pages/SharedPlanBenefitsPage'
import { DataPlaneNodesPage } from '@/features/data-plane-nodes/pages/DataPlaneNodesPage'
import { UserRelayAssignmentPage } from '@/features/data-plane-nodes/pages/UserRelayAssignmentPage'
import { OrdersPage } from '@/features/orders/pages/OrdersPage'

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
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/proxy" element={<ProxyConfigPage />} />
        <Route path="/releases" element={<ReleasesPage />} />
        <Route path="/releases/new" element={<ReleaseUploadPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/announcements" element={<AnnouncementsPage />} />
        <Route path="/data-plane-nodes" element={<DataPlaneNodesPage />} />
        <Route path="/users/relay/:uid" element={<UserRelayAssignmentPage />} />
        <Route path="/shared-plan-benefits" element={<SharedPlanBenefitsPage />} />
        <Route path="/orders" element={<OrdersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
