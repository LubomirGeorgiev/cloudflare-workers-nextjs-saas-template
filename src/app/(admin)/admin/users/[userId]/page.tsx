import { getUserData } from "../../_actions/get-user.action"
import { cache, Suspense } from "react"
import {
  UserCredentialsSection,
  UserCredentialsSkeleton,
} from "../../_components/users/user-credentials-section"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { format } from "date-fns"
import { getInitials } from "@/utils/name-initials"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import {
  Activity,
  Calendar,
  Mail,
  Shield,
  MapPin,
  Smartphone,
  Globe,
  Key
} from "lucide-react"
import type { InferSelectModel } from "drizzle-orm"
import type { passKeyCredentialTable } from "@/db/schema"


type PasskeyCredential = InferSelectModel<typeof passKeyCredentialTable>

interface UserDetailPageProps {
  params: Promise<{ userId: string }>
}

const getCachedUserData = cache(async (userId: string) => {
  return getUserData({ userId })
})

export async function generateMetadata({ params }: UserDetailPageProps): Promise<Metadata> {
  const { userId } = await params

  const { data, serverError } = await getCachedUserData(userId)
  if (serverError || !data) {
    return {
      title: "User Not Found",
      description: "The requested user could not be found",
    }
  }

  const { user } = data

  return {
    title: `${user.firstName && user.lastName ? `${user.firstName} ${user.lastName}` : user.email} - User Details`,
    description: `User details for ${user.email}`,
  }
}

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const { userId } = await params

  const { data, serverError } = await getCachedUserData(userId)
  if (serverError || !data) {
    notFound()
  }

  const { user, passkeys } = data

  const displayName = user?.firstName && user?.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.email



  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <PageHeader
        items={[
          { href: "/admin", label: "Admin" },
          { href: "/admin", label: "Users" },
          { href: `/admin/users/${user.id}`, label: displayName || "User Details" }
        ]}
      />

      <div className="grid gap-6 mt-6">
        {/* User Profile Card */}
        <Card>
          <CardHeader className="pb-4">
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                <AvatarImage src={user.avatar || ""} alt={displayName || ""} />
                <AvatarFallback className="text-lg">
                  {getInitials(`${user.firstName || ''} ${user.lastName || ''}`.trim())}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <CardTitle className="text-2xl">{displayName}</CardTitle>
                <CardDescription className="text-base mt-1">
                  User ID: {user.id}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Badge variant={user.role === "admin" ? "default" : "secondary"}>
                  {user.role}
                </Badge>
                <Badge variant={user.emailVerified ? "default" : "destructive"}>
                  {user.emailVerified ? "Verified" : "Unverified"}
                </Badge>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Contact Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Email</label>
                <p className="text-sm">{user.email || "No email"}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">First Name</label>
                <p className="text-sm">{user.firstName || "Not provided"}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Last Name</label>
                <p className="text-sm">{user.lastName || "Not provided"}</p>
              </div>
              {user.signUpIpAddress && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Sign-up IP Address
                  </label>
                  <p className="text-sm font-mono">{user.signUpIpAddress}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Account Details */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Account Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Created
                </label>
                <p className="text-sm">{format(user.createdAt, "PPpp")}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  Last Active
                </label>
                <p className="text-sm">{user.lastActiveAt ? format(user.lastActiveAt, "PPpp") : "Never"}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Last Updated</label>
                <p className="text-sm">{format(user.updatedAt, "PPpp")}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Password</label>
                <p className="text-sm">{user.passwordHash ? "Set" : "Not set"}</p>
              </div>
              {user.googleAccountId && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    Google Account
                  </label>
                  <p className="text-sm font-mono">{user.googleAccountId}</p>
                </div>
              )}
              {user.emailVerified && (
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Email Verified</label>
                  <p className="text-sm">{format(user.emailVerified, "PPpp")}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Passkeys */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5" />
                Passkeys ({passkeys.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {passkeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">No passkeys configured</p>
              ) : (
                <div className="space-y-3">
                  {passkeys.map((passkey: PasskeyCredential) => (
                    <div key={passkey.id} className="border rounded-lg p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Passkey</span>
                        <Badge variant="secondary" className="text-xs">
                          {format(passkey.createdAt, "MMM dd, yyyy")}
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>
                          <span className="font-medium">Counter:</span> {passkey.counter}
                        </div>
                        {passkey.aaguid && (
                          <div>
                            <span className="font-medium">AAGUID:</span> {passkey.aaguid.slice(0, 8)}...
                          </div>
                        )}
                      </div>
                      {passkey.userAgent && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-medium flex items-center gap-1">
                            <Smartphone className="h-3 w-3" />
                            Device:
                          </span>
                          <p className="mt-1 truncate">{passkey.userAgent}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Suspense fallback={<UserCredentialsSkeleton />}>
          <UserCredentialsSection userId={user.id} />
        </Suspense>
      </div>
    </div>
  )
}
