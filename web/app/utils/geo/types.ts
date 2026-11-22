import type { Place } from "../../types/api";
import type { Mode } from "../map";

/**
 * 地図まわりの共通の形。
 * Google の API を使う版(google.ts)と、API キーがないとき・テスト用の仮の版(fake.ts)が同じ形を持つ。
 * 座標は画面を開いている間だけメモリに持ち、保存しない。
 */

/** 場所の入力中に出す候補(画面に出すだけで、保存しない) */
export interface Suggestion {
  /** 候補を選んだときに使う ID */
  id: string;
  /** 主な名前(例: 清水寺) */
  main: string;
  /** 補足(例: 京都府京都市東山区) */
  sub?: string;
}

export interface LatLng {
  lat: number;
  lng: number;
}

/** 候補を選んだ結果 */
export interface ResolvedPlace {
  placeId: string;
  position: LatLng;
}

export interface PlaceSearch {
  suggest(text: string): Promise<Suggestion[]>;
  /** 候補を確定する。取れなければ null */
  resolve(suggestion: Suggestion): Promise<ResolvedPlace | null>;
  /** 保存した ID から、今の位置を取る */
  locate(placeId: string): Promise<LatLng | null>;
}

/** 1 区間の経路 */
export interface Leg {
  minutes: number;
  /** 地図に描く経路の線 */
  path?: LatLng[];
  /** 経路検索が返した注意(例: 徒歩の経路に歩道が無いことがある)。画面に必ず出す */
  warnings?: string[];
}

export interface RouteService {
  /** 経路が見つからなければ null */
  leg(from: Place, to: Place, mode: Mode): Promise<Leg | null>;
}
