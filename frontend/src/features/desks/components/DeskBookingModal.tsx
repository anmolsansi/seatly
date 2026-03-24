import React from "react";
import {
  type AvailabilitySlot,
  useCreateBookingMutation,
  useDeskAvailabilityQuery,
} from "@/features/desks/api/deskBookings";
import type {Desk} from "@/features/desks/api/desks";
import {useQueryClient} from "@tanstack/react-query";

type DeskBookingModalProps = {
  desk: Desk & { id: number };
  isOpen: boolean;
  onClose: () => void;
};

// "single" keeps existing behavior; "weekly" enables recurrence fields/payload.
type BookingMode = "single" | "weekly";

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1); // 1-based
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  // Local datetime without timezone/offset, matches Micronaut LocalDateTime
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeRange(slot: AvailabilitySlot): string {
  const start = new Date(slot.startAt);
  const end = new Date(slot.endAt);

  const pad = (n: number) => n.toString().padStart(2, "0");

  const startHours = pad(start.getHours());
  const startMinutes = pad(start.getMinutes());
  const endHours = pad(end.getHours());
  const endMinutes = pad(end.getMinutes());

  return `${startHours}:${startMinutes} – ${endHours}:${endMinutes}`;
}

export const DeskBookingModal: React.FC<DeskBookingModalProps> = ({
                                                                    desk,
                                                                    isOpen,
                                                                    onClose,
                                                                  }) => {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => new Date());
  // Recurrence controls introduced for recurring bookings.
  const [bookingMode, setBookingMode] = React.useState<BookingMode>("single");
  const [occurrences, setOccurrences] = React.useState("4");

  // Availability is always fetched for the selected business-hours window.
  const start = React.useMemo(
    () =>
      new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        9,
        0,
        0,
        0,
      ),
    [selectedDate],
  );

  const end = React.useMemo(
    () =>
      new Date(
        selectedDate.getFullYear(),
        selectedDate.getMonth(),
        selectedDate.getDate(),
        17,
        0,
        0,
        0,
      ),
    [selectedDate],
  );

  const startAt = toLocalDateTimeString(start);
  const endAt = toLocalDateTimeString(end);

  const {
    data: availability,
    isLoading,
    isError,
    error,
  } = useDeskAvailabilityQuery(desk.id, startAt, endAt);
  
  const bookingMutation = useCreateBookingMutation();
  const [bookingError, setBookingError] = React.useState<string | null>(null);

  const handleBackgroundClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    if (bookingMutation.isPending) return;
    e.stopPropagation();
    onClose();
  };

  const handleInnerClick: React.MouseEventHandler<HTMLDivElement> = (e) => {
    e.stopPropagation();
  };

  const handleBookSlot = async (slot: AvailabilitySlot) => {
    setBookingError(null);

    // Weekly mode must submit a positive integer occurrence count.
    const trimmedOccurrences = occurrences.trim();
    const parsedOccurrences = Number.parseInt(trimmedOccurrences, 10);
    if (bookingMode === "weekly" && (!Number.isInteger(parsedOccurrences) || parsedOccurrences < 1)) {
      setBookingError("Weekly recurring bookings require at least 1 occurrence.");
      return;
    }

    try {
      await bookingMutation.mutateAsync({
        deskId: desk.id,
        startAt: slot.startAt,
        endAt: slot.endAt,
        // Keep single-booking requests unchanged; only attach recurrence when selected.
        ...(bookingMode === "weekly"
          ? {
              // The modal keeps the current slot selection and only adds the
              // extra weekly recurrence details when requested by the user.
              recurrenceType: "WEEKLY" as const,
              occurrences: parsedOccurrences,
            }
          : {}),
      });

      // Refresh availability after successful booking
      await queryClient.invalidateQueries({
        queryKey: ["deskAvailability", desk.id, startAt, endAt],
      });

      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setBookingError(`Could not create booking: ${message}`);
    }
  };

  const handleDateChange: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const value = e.target.value; // "yyyy-MM-dd"
    if (!value) return;
    const [year, month, day] = value.split("-").map(Number);
    // Keep local time; hours/mins defined by start/end memos.
    const newDate = new Date(year, (month ?? 1) - 1, day ?? 1);
    if (!Number.isNaN(newDate.getTime())) {
      setSelectedDate(newDate);
    }
  };

  React.useEffect(() => {
    if (isOpen) {
      // Re-initialize modal state on each open so a previous choice doesn't leak.
      setSelectedDate(new Date());
      setBookingMode("single");
      setOccurrences("4");
      setBookingError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.4)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={handleBackgroundClick}
    >
      <div
        style={{
          backgroundColor: "#fff",
          padding: "1.5rem",
          borderRadius: "4px",
          width: "100%",
          maxWidth: "500px",
          boxShadow: "0 4px 10px rgba(0,0,0,0.15)",
        }}
        onClick={handleInnerClick}
      >
        <h2 style={{marginTop: 0, marginBottom: "0.75rem"}}>
          Book desk: {desk.name}
        </h2>

        {/* Recurrence controls are separate from date selection to keep single booking default simple. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.9rem",
          }}
        >
          <label htmlFor="booking-date" style={{whiteSpace: "nowrap"}}>
            Date:
          </label>
          <input
            id="booking-date"
            type="date"
            value={toDateInputValue(selectedDate)}
            onChange={handleDateChange}
            style={{padding: "0.25rem 0.4rem"}}
          />
          <span style={{marginLeft: "auto"}}>
            Showing availability 09:00 – 17:00
          </span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            marginBottom: "0.75rem",
            fontSize: "0.9rem",
            flexWrap: "wrap",
          }}
        >
          <label htmlFor="booking-mode" style={{whiteSpace: "nowrap"}}>
            Booking type:
          </label>
          <select
            id="booking-mode"
            value={bookingMode}
            onChange={(e) => setBookingMode(e.target.value as BookingMode)}
            style={{padding: "0.25rem 0.4rem"}}
          >
            <option value="single">Single booking</option>
            <option value="weekly">Weekly recurring</option>
          </select>

          {bookingMode === "weekly" && (
            <>
              <label htmlFor="booking-occurrences" style={{whiteSpace: "nowrap"}}>
                Weeks:
              </label>
              <input
                id="booking-occurrences"
                type="number"
                min={1}
                step={1}
                value={occurrences}
                onChange={(e) => setOccurrences(e.target.value)}
                style={{padding: "0.25rem 0.4rem", width: "5rem"}}
              />
            </>
          )}
        </div>

        {isLoading && <p>Loading availability...</p>}

        {isError && (
          <p style={{color: "red"}}>
            Failed to load availability: {error?.message}
          </p>
        )}

        {!isLoading && !isError && (!availability || availability.length === 0) && (
          <p>No availability data for this period.</p>
        )}

        {!isLoading && !isError && availability && availability.length > 0 && (
          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              border: "1px solid #ddd",
              borderRadius: "4px",
            }}
          >
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.9rem",
              }}
            >
              <thead>
              <tr>
                <th
                  style={{
                    textAlign: "left",
                    padding: "0.5rem",
                    borderBottom: "1px solid #ddd",
                  }}
                >
                  Time
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "0.5rem",
                    borderBottom: "1px solid #ddd",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "0.5rem",
                    borderBottom: "1px solid #ddd",
                  }}
                >
                  Action
                </th>
              </tr>
              </thead>
              <tbody>
              {availability.map((slot, index) => {
                const isAvailable =
                  String(slot.status).toUpperCase() === "AVAILABLE";

                return (
                  <tr key={`${slot.startAt}-${slot.endAt}-${index}`}>
                    <td
                      style={{
                        padding: "0.5rem",
                        borderBottom: "1px solid #eee",
                      }}
                    >
                      {formatTimeRange(slot)}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem",
                        borderBottom: "1px solid #eee",
                        textTransform: "capitalize",
                      }}
                    >
                      {slot.status.toLowerCase()}
                    </td>
                    <td
                      style={{
                        padding: "0.5rem",
                        borderBottom: "1px solid #eee",
                        textAlign: "right",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => handleBookSlot(slot)}
                        disabled={!isAvailable || bookingMutation.isPending}
                        style={{
                          padding: "0.3rem 0.7rem",
                          cursor:
                            isAvailable && !bookingMutation.isPending
                              ? "pointer"
                              : "not-allowed",
                        }}
                      >
                        {isAvailable ? "Book" : "Unavailable"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            </table>
          </div>
        )}

        {bookingError && (
          <p style={{color: "red", marginTop: "0.75rem"}}>{bookingError}</p>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            marginTop: "1rem",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{padding: "0.4rem 0.8rem", cursor: "pointer"}}
            disabled={bookingMutation.isPending}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
