// React Native Firebase adapter. Install @react-native-firebase/app, auth, functions, storage.
// Google sign-in supplies Firebase Auth credentials separately. UID never goes in payloads.
import functions from "@react-native-firebase/functions";
import storage from "@react-native-firebase/storage";
export const api = async <T>(
  name: string,
  payload: Record<string, unknown> = {},
): Promise<T> => {
  const response = await functions(undefined, "asia-northeast3").httpsCallable(
    name,
  )(payload);
  return response.data as T;
};
export const mutation = <T>(
  name: string,
  clientRequestId: string,
  payload: Record<string, unknown>,
) => api<T>(name, { ...payload, clientRequestId });
// Persist clientRequestId with an operation until a definitive response. Change ID when
// changing the payload. Never create a new ID just because the connection timed out.
export async function uploadEvidence(
  uploadPath: string,
  localJpegPath: string,
) {
  await storage()
    .ref(uploadPath)
    .putFile(localJpegPath, { contentType: "image/jpeg" });
  // Call getPhotoStatus until READY; surface FAILED and retain the local source file.
}
