// Global app constants (names, routes, API endpoints, etc.)
export const APP_NAME = "UpReview" as const;

export type Slug = string;

export const ROUTES = {
  HOME: "/",
  SIGN_UP: "/sign-up",
  LOG_IN: "/log-in",
  ONBOARD_GOOGLE: "/onboarding-flow/link-google",
  DASHBOARD: "/dashboard",
  DASHBOARD_BASE: (slug: Slug, businessSlug: Slug) =>
    `/dashboard/${encodeURIComponent(slug)}/${encodeURIComponent(businessSlug)}`,

  DASHBOARD_HOME: (slug: Slug, businessSlug: Slug) =>
    `${ROUTES.DASHBOARD_BASE(slug, businessSlug)}`,

  DASHBOARD_ANALYTICS: (slug: Slug, businessSlug: Slug) =>
    `${ROUTES.DASHBOARD_BASE(slug, businessSlug)}/analytics`,

  DASHBOARD_CLIENTS: (slug: Slug, businessSlug: Slug) =>
    `${ROUTES.DASHBOARD_BASE(slug, businessSlug)}/clients`,

  DASHBOARD_BUSINESS_SETTINGS: (slug: Slug, businessSlug: Slug) =>
    `${ROUTES.DASHBOARD_BASE(slug, businessSlug)}/settings/business-settings`,

} as const;

export const NAV_ITEMS = [
  { key: "home", label: "Home", href: ROUTES.DASHBOARD_HOME },
  { key: "analytics", label: "Analytics", href: ROUTES.DASHBOARD_ANALYTICS },
  { key: "clients", label: "Clients", href: ROUTES.DASHBOARD_CLIENTS },
] as const;

export const API = {
  RECORD_SIGN_UP: "/api/users/record-sign-up",
  GET_MY_SLUG_BY_EMAIL: "/api/users/get-slug-by-email",
  BUSINESSES_LIST: "/api/businesses/list",
  SIGN_UP: "/api/sign-up",
  SAVE_USER_SETTINGS: "/api/save-user-settings",
  GOOGLE_HAS_CONNECTION: "/api/google/has-connection",
  BUSINESS_GOOGLE_CONNECTED: "/api/business-actions/google-connected",
  BUSINESSES_CREATE: "/api/businesses/create",
  GET_NAME: "/api/get-name",
  XERO_CONNECT: "/api/xero/connect-to-xero",
  XERO_HAS_CONNECTION: "/api/xero/has-xero-connection",
  BUSINESS_XERO_CONNECTED: "/api/business-actions/xero-connected",
  BUSINESSES_GET_DETAILS: "/api/businesses/get-business-details",
  BUSINESSES_SAVE_DETAILS: "/api/businesses/save-details",
  BUSINESSES_ONBOARDED: "/api/business-actions/onboarded",
  GET_BUSINESS_SLUG: "/api/businesses/get-slug",
  CHECK_BUSINESS_STAGE: "/api/business-actions/check-onboarding-stage",
  GET_BUSINESS_ID_BY_SLUG: "/api/businesses/get-id-by-slug",
  RETRIEVE_LOGO_URL: "/api/businesses/get-logo-url",
  DASHBOARD_CHECK_NEW_USER: "/api/users/is-new-user",
  REVIEWS_GET_RECENT: "/api/business-dashboard/get-recent-reviews",
  GET_GRAPH_INFO: "/api/analytics/get-graph-info",
  GET_CLIENTS: "/api/clients/get-clients",
  GET_CLIENTS_FROM_XERO: "/api/xero/get-clients-from-xero",
  CLIENTS_SYNC_GOOGLE_REVIEWS: "/api/google/sync-gr-with-clients",
  LINK_GR_TO_CLIENTS: "/api/google/link-gr-to-clients",
  EMAILS_SEND_BULK: "/api/clients/send-bulk-emails",
  ADD_CLIENT: "/api/clients/add-client",
  GBU_COUNTS: "/api/analytics/get-gbu-counts",
  EMAIL_ANALYTICS: "/api/analytics/email-statistics",
  AVG_EMAIL_TO_CLICK: "/api/analytics/time-to-click",
  GET_PHRASES_EXCERPTS: "/api/analytics/get-phrases-excerpts",
  ANALYTICS_GET_REVIEW: "/api/analytics/get-review",
  MAKE_EXCERPTS: "/api/analytics/make-excerpts",
  BUSINESS_SLUG_AVAILABILITY: "/api/businesses/slug-availability",
  UPLOAD_LOGO: "/api/businesses/upload-company-logo",
  UPDATE_BUSINESS_DESCRIPTION: "/api/businesses/update-description",
  UPDATE_BUSINESS_GOOGLE_LINK: "/api/businesses/update-google-link",
  UPDATE_BUSINESS_SLUG: "/api/businesses/update-slug",
  GET_EMAIL_TEMPLATE: "/api/email-settings/get-template",
  SAVE_EMAIL_TEMPLATE: "/api/email-settings/save-template",
  SEND_TEST_EMAIL: "/api/email-settings/send-test",
  REVIEW_SETTINGS_ADD_PHRASES: "/api/review-settings/add-phrases",
  REVIEW_SETTINGS_DELETE_PHRASE: "/api/review-settings/delete-phrase",
  GENERATE_PHRASES: "/api/analytics/extract-phrases",
  ADD_GENERATED_PHRASES: "/api/review-settings/add-generated-phrases",
  REVIEW_CLICKED_UPDATE: "/api/client-actions/review-clicked",
  GET_GOOD_PHRASES: "/api/review-submit/get-good-phrases",
  PUBLIC_GET_BUSINESS_DETAILS: "/api/review-submit/get-business-details",
  PUBLIC_GET_GOOD_PHRASES: "/api/review-submit/get-good-phrases",
  PUBLIC_GENERATE_GOOD_REVIEWS: "/api/review-submit/generate-good-review",
  PUBLIC_SUBMIT_REVIEW: "/api/review-submit/submit-review",
  SWAP_BUSINESS: "/api/businesses/swap-business",
  GOOGLE_GET_REVIEWS: "/api/google/get-reviews",
  AUTHORIZE_ADMIN: "/api/admin/authorize",
  GET_USERNAME: "/api/users/get-username",
  GET_BUS_NAME_FROM_ID: "/api/businesses/get-name-from-id",
} as const;

export const PASSWORD = {
  MIN_LEN: 8,
} as const;

export type Stage = "link_google" | "link-xero" | "onboarding" | "already_linked";