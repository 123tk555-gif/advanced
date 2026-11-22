// API の応答の形(api/src の各 repo が返すものと同じ)

export type Role = "owner" | "member";

/** 保存している場所。座標は持たない(表示のたびに ID から取る) */
export interface Place {
  placeId: string;
  /** 利用者が入力した表示名 */
  label: string;
}

export interface Trip {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  destination: string;
  ownerId: string;
  memberCount: number;
  createdAt: string;
}

export interface MyTrip extends Trip {
  role: Role;
}

export interface Member {
  userId: string;
  displayName: string;
  role: Role;
  joinedAt: string;
}

export interface Comment {
  commentId: string;
  itemId: string;
  userId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface Item {
  itemId: string;
  day: number;
  order: string;
  time: string;
  title: string;
  place: Place | null;
  memo: string;
  version: number;
  updatedBy: string;
  updatedAt: string;
}

export interface ItemWithComments extends Item {
  comments: Comment[];
}

export interface Idea {
  ideaId: string;
  name: string;
  place: Place | null;
  note: string;
  createdBy: string;
  createdAt: string;
  adoptedItemId: string | null;
  voteCount: number;
  voters: string[];
  myVote: boolean;
}

export interface Expense {
  expenseId: string;
  title: string;
  amount: number;
  paidBy: string;
  splitWith: string[];
  createdBy: string;
  createdAt: string;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

export interface TripView {
  trip: Trip;
  members: Member[];
  items: ItemWithComments[];
  ideas: Idea[];
  expenses: Expense[];
  settlement: Transfer[];
  myRole: Role;
  invite: { token: string; expiresAt: string } | null;
  public: { token: string } | null;
}

export interface JoinRequest {
  userId: string;
  displayName: string;
  requestedAt: string;
}

export interface JoinInfo {
  trip: { title: string; memberCount: number };
  status: "none" | "pending" | "member";
  tripId?: string;
}

export interface PublicItem {
  itemId: string;
  day: number;
  order: string;
  time: string;
  title: string;
  place: Place | null;
  memo: string;
}

export interface PublicView {
  trip: { title: string; startDate: string; endDate: string; destination: string };
  members: { displayName: string }[];
  items: PublicItem[];
}
