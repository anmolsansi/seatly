import {useAuth} from "@/features/auth/AuthContext";
import {useMutation, useQuery} from "@tanstack/react-query";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

export type AvailabilityStatus = "AVAILABLE" | "BOOKED";

export type AvailabilitySlot = {
  startAt: string; // ISO-like string
  endAt: string;
  status: AvailabilityStatus;
};

export type CreateBookingInput = {
  deskId: number;
  startAt: string;
  endAt: string;
  // Only weekly recurrence.
  recurrenceType?: "WEEKLY";
  occurrences?: number;
};

type ApiError = {
  message?: string;
};

async function fetchDeskAvailability(
  accessToken: string | null,
  deskId: number,
  startAt: string,
  endAt: string,
): Promise<AvailabilitySlot[]> {
  if (!accessToken) {
    throw new Error("Not authenticated");
  }

  const params = new URLSearchParams({
    startAt,
    endAt,
  });

  const response = await fetch(
    `${API_BASE_URL}/desks/${deskId}/availability?${params.toString()}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    let errorBody: ApiError | undefined;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // ignore parse error
    }

    const message =
      errorBody?.message ||
      (response.status === 401
        ? "You are not authorized to view desk availability."
        : "Failed to load desk availability.");

    throw new Error(message);
  }

  return (await response.json()) as AvailabilitySlot[];
}

export function useDeskAvailabilityQuery(
  deskId: number | null | undefined,
  startAt: string | null,
  endAt: string | null,
) {
  const {accessToken} = useAuth();

  return useQuery<AvailabilitySlot[], Error>({
    queryKey: ["deskAvailability", deskId, startAt, endAt],
    queryFn: () =>
      fetchDeskAvailability(
        accessToken,
        deskId as number,
        startAt as string,
        endAt as string,
      ),
    enabled: !!accessToken && !!deskId && !!startAt && !!endAt,
  });
}

async function createBooking(
  accessToken: string | null,
  input: CreateBookingInput,
) {
  if (!accessToken) {
    throw new Error("Not authenticated");
  }

  const {deskId, startAt, endAt, recurrenceType, occurrences} = input;

  const response = await fetch(`${API_BASE_URL}/desks/${deskId}/bookings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    // Recurrence fields are only sent when the user chooses weekly booking.
    body: JSON.stringify({
      startAt,
      endAt,
      ...(recurrenceType ? {recurrenceType, occurrences} : {}),
    }),
  });

  if (!response.ok) {
    let errorBody: ApiError | undefined;
    try {
      errorBody = (await response.json()) as ApiError;
    } catch {
      // ignore parse error
    }

    const message =
      errorBody?.message ||
      (response.status === 401
        ? "You are not authorized to create bookings."
        : "Failed to create booking.");

    throw new Error(message);
  }

  return await response.json();
}

export function useCreateBookingMutation() {
  const {accessToken} = useAuth();

  return useMutation({
    mutationFn: (input: CreateBookingInput) => createBooking(accessToken, input),
  });
}
