import {beforeEach, describe, expect, it} from "vitest";
import {screen, waitFor, within} from "@testing-library/react";
import userEvent, {type UserEvent} from "@testing-library/user-event";
import {renderWithProviders} from "@/test-utils/renderWithProviders";
import {server} from "@/test-utils/msw/server";
import {http, HttpResponse} from "msw";
import DeskDashboardPage from "./DeskDashboardPage";

async function openBookingModal(user: UserEvent) {
  // Reuse the same modal-opening flow across tests so they all exercise the
  // real UI path before asserting booking behavior.
  await screen.findByRole("heading", {name: /dashboard/i});
  await screen.findByText("Desk A");

  const bookButtons = screen.getAllByRole("button", {name: /^book$/i});
  await user.click(bookButtons[0]);

  const modalHeading = await screen.findByRole("heading", {
    name: /book desk: desk a/i,
  });
  const modal = modalHeading.closest("div");
  if (!modal) {
    throw new Error("Booking modal container not found");
  }

  const modalUtils = within(modal);
  await modalUtils.findByText(/showing availability 09:00 – 17:00/i);
  return modalUtils;
}

describe("DeskDashboardPage", () => {

  let user: UserEvent;

  beforeEach(() => {
    user = userEvent.setup();
    renderWithProviders(<DeskDashboardPage/>, {
      initialEntries: ["/desks"],
      initialAuth: {
        user: {
          id: 1,
          email: "test@example.com",
          fullName: "Test User",
        },
        accessToken: "abc123",
      },
    });
  });

  it("renders desks returned from the API in the table", async () => {
    await screen.findByRole("heading", {name: /dashboard/i});

    expect(await screen.findByText("Desk A")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("1st Floor")).toBeInTheDocument();

    expect(await screen.findByText("Desk B")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("-")).toBeInTheDocument();

    expect(
      screen.getAllByRole("button", {name: /book/i}).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("opens the create desk modal and allows submitting a new desk", async () => {
    await screen.findByRole("heading", {name: /dashboard/i});

    const openCreateButton = screen.getByRole("button", {
      name: /create desk/i,
    });
    await user.click(openCreateButton);
    const modalHeading = await screen.findByRole("heading", {
      name: /create desk/i,
    });
    const modal = modalHeading.closest("div");
    if (!modal) {
      throw new Error("Create desk modal container not found");
    }

    const modalUtils = within(modal);
    await user.type(modalUtils.getByLabelText(/name/i), "Desk C");
    await user.type(modalUtils.getByLabelText(/location/i), "3rd Floor");

    const submitButton = modalUtils.getByRole("button", {name: /create desk/i});
    await user.click(submitButton);
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", {name: /create desk/i}),
      ).not.toBeInTheDocument();
    });

    expect(await screen.findByText("Desk C")).toBeInTheDocument();
    expect(screen.getByText("3rd Floor")).toBeInTheDocument();
  });

  it("allows booking a desk from the booking modal", async () => {
    const modalUtils = await openBookingModal(user);

    const slotBookButtons = await modalUtils.findAllByRole("button", {
      name: /^book$/i,
    });

    await user.click(slotBookButtons[0]);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", {name: /book desk: desk a/i}),
      ).not.toBeInTheDocument();
    });
  });

  it("shows recurring controls and sends weekly booking payload", async () => {
    let capturedBookingBody: Record<string, unknown> | null = null;

    server.use(
      http.post("*/desks/:deskId/bookings", async ({params, request}) => {
        const deskId = Number(params.deskId);
        capturedBookingBody = (await request.json()) as Record<string, unknown>;

        return HttpResponse.json(
          {
            id: 101,
            deskId,
            userId: 1,
            startAt: capturedBookingBody.startAt,
            endAt: capturedBookingBody.endAt,
            recurrenceType: capturedBookingBody.recurrenceType ?? null,
            createdCount: capturedBookingBody.occurrences ?? 1,
            bookings: [
              {
                id: 101,
                startAt: capturedBookingBody.startAt,
                endAt: capturedBookingBody.endAt,
              },
            ],
          },
          {status: 201},
        );
      }),
    );

    const modalUtils = await openBookingModal(user);

    await user.selectOptions(
      modalUtils.getByLabelText(/booking type/i),
      "weekly",
    );

    const weeksInput = modalUtils.getByLabelText(/weeks/i);
    expect(weeksInput).toBeInTheDocument();
    await user.clear(weeksInput);
    await user.type(weeksInput, "6");

    const slotBookButtons = await modalUtils.findAllByRole("button", {
      name: /^book$/i,
    });
    await user.click(slotBookButtons[0]);

    await waitFor(() => {
      expect(capturedBookingBody).not.toBeNull();
    });

    expect(capturedBookingBody).toMatchObject({
      recurrenceType: "WEEKLY",
      occurrences: 6,
    });
  });

  it("shows backend booking conflict errors in the booking modal", async () => {
    server.use(
      http.post("*/desks/:deskId/bookings", () =>
        HttpResponse.json(
          {message: "Desk is already booked for the given time range"},
          {status: 409},
        ),
      ),
    );

    const modalUtils = await openBookingModal(user);

    await user.selectOptions(
      modalUtils.getByLabelText(/booking type/i),
      "weekly",
    );

    const slotBookButtons = await modalUtils.findAllByRole("button", {
      name: /^book$/i,
    });
    await user.click(slotBookButtons[0]);

    expect(
      await modalUtils.findByText(
        /could not create booking: desk is already booked for the given time range/i,
      ),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("heading", {name: /book desk: desk a/i}),
    ).toBeInTheDocument();
  });
});
