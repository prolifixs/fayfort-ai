// Public contact details shared by every page on fayfort.com.

export const SUPPORT_EMAIL = 'support@fayfort.com'
export const SOURCING_ENQUIRY_URL = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Sourcing enquiry')}`

export const FAYFORT_INSTAGRAM = 'fayfort_international_trading'
export const FAYFAY_SOCIAL_HANDLE = 'skiinniiee_fay_fay' // same handle on Instagram and TikTok

export const WHATSAPP_URL = 'https://wa.me/8618268130381'
export const WHATSAPP_DISPLAY = '+86 182 6813 0381'

// The member dashboard (app.fayfort.com). The public site sends people there to join, sign in, chat and send requests.
export const APP_URL = 'https://app.fayfort.com'
export const JOIN_URL = `${APP_URL}/member/signup`
export const SIGN_IN_URL = `${APP_URL}/member/account`
export const CHAT_URL = `${APP_URL}/member/chat`
// Where the website's "My dashboard" button goes for members (the member Home once it exists, docs/UI_FACELIFT_PLAN.md).
export const MEMBER_HOME_URL = CHAT_URL
export const BROWSE_URL = `${APP_URL}/member/chat?panel=catalog`
export const DIRECTORY_URL = `${APP_URL}/member/chat?panel=tools&tool=directory`
export const REQUESTS_URL = `${APP_URL}/member/chat?panel=requests`

// Working hours (the same as the chat assistant tells customers).
export const SUPPORT_HOURS = 'Monday to Saturday, 9:30 to 18:30 China time'
