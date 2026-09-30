import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AvailabilityPage from "@/app/(dashboard)/availability/page";

// Mock data
const mockConfig = {
  weekStartDay: 1,
  coverageRequirements: [
    { role: "barista", days: [1, 2, 3, 4, 5], startTime: "06:00", endTime: "14:00", minStaff: 2 },
    { role: "barista", days: [1, 2, 3, 4, 5], startTime: "14:00", endTime: "22:00", minStaff: 2 },
  ],
  operatingHours: {
    0: { open: "06:00", close: "22:00" },
    1: { open: "06:00", close: "22:00" },
    2: { open: "06:00", close: "22:00" },
    3: { open: "06:00", close: "22:00" },
    4: { open: "06:00", close: "22:00" },
    5: { open: "06:00", close: "22:00" },
    6: { open: "06:00", close: "22:00" },
  },
  availabilityDeadlineDay: 3,
  availabilityDeadlineHour: 18,
  reminderIntervals: [48, 24, 2],
  maxConsecutiveDays: 5,
  minRestHoursBetweenShifts: 10,
  costWeight: 0.33,
  fairnessWeight: 0.34,
  preferenceWeight: 0.33,
};

const mockBusiness = { id: "b1", name: "Test Cafe", config: mockConfig };

const mockStaffList = [
  { id: "s1", name: "Alice", isActive: true },
  { id: "s2", name: "Bob", isActive: true },
  { id: "s3", name: "Charlie", isActive: false },
];

const mockSubmissions = [
  {
    id: "sub1",
    staffId: "s1",
    weekStart: new Date("2026-04-20"),
    status: "submitted" as const,
    slots: [
      { day: "2026-04-20", startTime: "06:00", endTime: "14:00", preference: "available" as const },
      { day: "2026-04-20", startTime: "14:00", endTime: "22:00", preference: "preferred" as const },
      { day: "2026-04-21", startTime: "06:00", endTime: "14:00", preference: "available" as const },
      { day: "2026-04-21", startTime: "14:00", endTime: "22:00", preference: "unavailable" as const },
      { day: "2026-04-22", startTime: "06:00", endTime: "14:00", preference: "available" as const },
      { day: "2026-04-22", startTime: "14:00", endTime: "22:00", preference: "available" as const },
      { day: "2026-04-23", startTime: "06:00", endTime: "14:00", preference: "available" as const },
      { day: "2026-04-23", startTime: "14:00", endTime: "22:00", preference: "available" as const },
      { day: "2026-04-24", startTime: "06:00", endTime: "14:00", preference: "unavailable" as const },
      { day: "2026-04-24", startTime: "14:00", endTime: "22:00", preference: "unavailable" as const },
      { day: "2026-04-25", startTime: "06:00", endTime: "14:00", preference: "unavailable" as const },
      { day: "2026-04-25", startTime: "14:00", endTime: "22:00", preference: "unavailable" as const },
      { day: "2026-04-26", startTime: "06:00", endTime: "14:00", preference: "unavailable" as const },
      { day: "2026-04-26", startTime: "14:00", endTime: "22:00", preference: "unavailable" as const },
    ],
    submittedAt: new Date(),
    staff: { id: "s1", name: "Alice" },
  },
];

// State trackers for mock queries
let businessData: typeof mockBusiness | undefined = undefined;
let staffListData: typeof mockStaffList | undefined = undefined;
let submissionsData: typeof mockSubmissions | undefined = undefined;

const mockMutate = vi.fn();
const mockInvalidate = vi.fn();

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    business: {
      getCurrent: {
        useQuery: () => ({
          data: businessData,
          isLoading: !businessData,
          error: null,
        }),
      },
    },
    staff: {
      list: {
        useQuery: () => ({
          data: staffListData,
          isLoading: !staffListData,
          error: null,
        }),
      },
    },
    availability: {
      listForWeek: {
        useQuery: (_input: any, _opts?: any) => ({
          data: submissionsData,
          isLoading: !submissionsData,
          error: null,
        }),
      },
      submit: {
        useMutation: () => ({
          mutate: mockMutate,
          isPending: false,
        }),
      },
    },
    useUtils: () => ({
      availability: {
        listForWeek: { invalidate: mockInvalidate },
      },
    }),
  },
}));

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock lucide icons to simple elements
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  return {
    ...actual,
    ChevronLeft: () => <span data-testid="chevron-left" />,
    ChevronRight: () => <span data-testid="chevron-right" />,
    Pencil: () => <span data-testid="pencil" />,
  };
});

describe("AvailabilityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    businessData = undefined;
    staffListData = undefined;
    submissionsData = undefined;
  });

  describe("loading state", () => {
    it('shows "Loading..." when business config has not loaded', () => {
      businessData = undefined;
      const { container } = render(<AvailabilityPage />);
      expect(screen.getByRole("heading", { name: "Availability" })).toBeInTheDocument();
      expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
    });
  });

  describe("staff table", () => {
    beforeEach(() => {
      businessData = mockBusiness;
      staffListData = mockStaffList;
      submissionsData = mockSubmissions;
    });

    it("renders active staff members in table rows", () => {
      render(<AvailabilityPage />);
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    it("filters out inactive staff", () => {
      render(<AvailabilityPage />);
      expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    });

    it('shows "Not submitted" badge for staff without submissions', () => {
      render(<AvailabilityPage />);
      expect(screen.getByText("Not submitted")).toBeInTheDocument();
    });

    it('shows "Submitted" badge for submitted staff', () => {
      render(<AvailabilityPage />);
      expect(screen.getAllByText("Submitted").length).toBeGreaterThan(0);
    });

    it('shows "Confirmed" badge for confirmed staff', () => {
      submissionsData = [
        {
          ...mockSubmissions[0],
          status: "confirmed" as const,
        },
      ];
      render(<AvailabilityPage />);
      expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    });

    it("shows correct slot count", () => {
      render(<AvailabilityPage />);
      // Alice has 7 non-unavailable hourly slots out of 112 open weekly slots.
      expect(screen.getByText("7/112")).toBeInTheDocument();
      expect(screen.getByText("0/112")).toBeInTheDocument();
    });
  });

  describe("week navigation", () => {
    beforeEach(() => {
      businessData = mockBusiness;
      staffListData = mockStaffList;
      submissionsData = [];
    });

    it("shows formatted week range label", () => {
      render(<AvailabilityPage />);
      // The page should show the week range for the current week starting Monday
      // We verify it contains a formatted range pattern
      const weekLabel = screen.getByText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
      expect(weekLabel).toBeInTheDocument();
    });

    it("clicking next updates the displayed week range", async () => {
      const user = userEvent.setup();
      render(<AvailabilityPage />);

      const currentLabel = screen.getByText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
      const initialText = currentLabel.textContent;

      // Click next button (ChevronRight)
      const nextBtns = screen.getAllByRole("button");
      // The next button is the one after the week label (second icon button)
      const nextBtn = nextBtns.find(
        (btn) => btn.querySelector('[data-testid="chevron-right"]') !== null,
      );
      expect(nextBtn).toBeDefined();
      await user.click(nextBtn!);

      // The label should have changed
      const updatedLabel = screen.getByText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
      expect(updatedLabel.textContent).not.toBe(initialText);
    });

    it("clicking prev updates the displayed week range", async () => {
      const user = userEvent.setup();
      render(<AvailabilityPage />);

      const currentLabel = screen.getByText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
      const initialText = currentLabel.textContent;

      const prevBtn = screen.getAllByRole("button").find(
        (btn) => btn.querySelector('[data-testid="chevron-left"]') !== null,
      );
      expect(prevBtn).toBeDefined();
      await user.click(prevBtn!);

      const updatedLabel = screen.getByText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
      expect(updatedLabel.textContent).not.toBe(initialText);
    });
  });

  describe("edit action", () => {
    beforeEach(() => {
      businessData = mockBusiness;
      staffListData = mockStaffList;
      submissionsData = mockSubmissions;
    });

    it("clicking edit button on a staff row opens the grid dialog", async () => {
      const user = userEvent.setup();
      render(<AvailabilityPage />);

      await user.click(screen.getByRole("button", { name: "Edit availability for Alice" }));

      // The grid dialog should now be open showing Alice's name
      expect(
        screen.getByText("Edit Availability — Alice"),
      ).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows empty state message when no active staff exist", () => {
      businessData = mockBusiness;
      staffListData = [{ id: "s3", name: "Charlie", isActive: false }];
      submissionsData = [];
      render(<AvailabilityPage />);
      expect(screen.getByText("No active staff members.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Add staff members" })).toBeInTheDocument();
    });
  });
});
