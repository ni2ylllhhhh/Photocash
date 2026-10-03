export interface RequiredChannel {
  name: string;
  username: string;
  url: string;
}

export interface Settings {
  postReward: number;
  postRewardIntervalMin: number;
  passiveReward: number;
  passiveIntervalMin: number;
  referBonus: number;
  signupBonus: number;
  l1Percent: number;
  l2Percent: number;
  l3Percent: number;
  minWithdraw: number;
  minReferrals: number;
  botLink: string;
  botUsername: string;
  appShortName: string;
  botToken: string;
  supportLink: string;
  imgbbKey: string;
  imgbbKeys?: string[];
  adminPassword: string;
  adEnabled: boolean;
  adImage: string;
  adLink: string;
  adCode: string;
  starAdLink: string;
  channelPopupDelaySec?: number;
  announcement: string;
  forceChannelJoin?: boolean;
  requiredChannels?: RequiredChannel[];
  webAppUrl?: string;
}

export const DEFAULT_AD_CODE = `<script>
  atOptions = {
    'key' : '911ee250303f0d466e6e2cab58b077e0',
    'format' : 'iframe',
    'height' : 250,
    'width' : 300,
    'params' : {}
  };
</script>
<script src="https://glamourpicklessteward.com/911ee250303f0d466e6e2cab58b077e0/invoke.js"></script>`;

export const defaultSettings: Settings = {
  postReward: 0.02,
  postRewardIntervalMin: 10,
  passiveReward: 0.009,
  passiveIntervalMin: 10,
  referBonus: 0.5,
  signupBonus: 0.5,
  l1Percent: 20,
  l2Percent: 15,
  l3Percent: 5,
  minWithdraw: 5,
  minReferrals: 15,
  botLink: "https://t.me/PhotoCash12_bot",
  botUsername: "PhotoCash12_bot",
  appShortName: "app",
  botToken: "8738784866:AAFk8eHwv2xuswJTCBxGcvKAwZuUJHq4bK0",
  supportLink: "https://t.me/Click2Cash_Site",
  imgbbKey: "f3ca95750adeb1abc4ecc8e725991337",
  imgbbKeys: [
    "f3ca95750adeb1abc4ecc8e725991337",
    "2e443aefdb90e0bfa664342d214a99a7",
    "02218ebe0262d0e4b891ccf9786d24fe",
    "5a024dc769944312ea5bf67fe42d2b27",
    "ba2d5677268f9b2dc7ff89bb2f5d33f8",
  ],
  adminPassword: "445566",
  adEnabled: true,
  adImage: "",
  adLink: "",
  adCode: DEFAULT_AD_CODE,
  starAdLink: "https://ads.ziniyaapu7.workers.dev/",
  channelPopupDelaySec: 39,
  announcement: "",
  forceChannelJoin: true,
  requiredChannels: [
    {
      name: "Main Channel",
      username: "jgjghjghh687",
      url: "https://t.me/jgjghjghh687",
    },
    {
      name: "Support Channel",
      username: "Earning_Money_Lob",
      url: "https://t.me/Earning_Money_Lob",
    },
  ],
  webAppUrl: "https://photocash.ziniyaapu7.workers.dev/",
};

export const APP_LOGO_URL = "https://i.ibb.co.com/cS6GZXp9/IMG-20260929-215654-333.jpg";
export const REFER_BANNER_URL = "https://i.ibb.co.com/BVw639zT/Screenshot-20260929-203139.jpg";
export const BKASH_LOGO_URL = "https://i.ibb.co.com/0VQMxDL6/images.png";
export const NAGAD_LOGO_URL = "https://i.ibb.co.com/MzvRGdq/images.jpg";
export const BINANCE_LOGO_URL = "https://i.ibb.co.com/pjs0BQNc/images-1.png";

export interface User {
  id: string;
  name: string;
  username: string;
  photo: string;
  bio?: string;
  balance: number;
  totalEarned: number;
  todayEarned: number;
  todayKey: string;
  postCount: number;
  referrals: number;
  l2Referrals?: number;
  l3Referrals?: number;
  referredBy?: string | null;
  binanceId?: string;
  bkashNumber?: string;
  nagadNumber?: string;
  createdAt: number;
  lastAccrual?: number;
  lastPostRewardAt?: number;
  banned?: boolean;
  channelsVerified?: boolean;
  channelsVerifiedAt?: number;
  followers?: Record<string, boolean>;
  following?: Record<string, boolean>;
}

export interface Post {
  id: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorPhoto: string;
  caption: string;
  imageUrl: string;
  createdAt: number;
  likes?: Record<string, boolean>;
  starsCount?: number;
  stars?: number | Record<string, boolean>;
  comments?: Record<string, Comment>;
}

export interface Comment {
  id: string;
  uid: string;
  name: string;
  photo: string;
  emoji: string;
  createdAt: number;
}

export interface Story {
  id: string;
  authorId: string;
  authorName: string;
  authorPhoto: string;
  imageUrl: string;
  createdAt: number;
}

export interface Withdrawal {
  id: string;
  uid: string;
  name: string;
  username: string;
  amount: number;
  method: string;
  account: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
}
