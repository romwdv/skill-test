import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fakeToken, GAME_STATE, PARTICIPANTS } from "./test/helpers";

async function summary(): Promise<HTMLElement> {
  return screen.findByText(
    (_content, element) =>
      (element?.tagName === "P" && element.textContent?.includes("ont tiré")) ?? false,
  );
}

vi.mock("./lib/api", async () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 0) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  }
  return {
    ApiError,
    adminLogin: vi.fn(),
    fetchGameState: vi.fn(),
    fetchParticipants: vi.fn(),
    addParticipant: vi.fn(),
    deleteParticipant: vi.fn(),
    regenerateParticipantLink: vi.fn(),
    forceDraw: vi.fn(),
  };
});

import {
  adminLogin,
  fetchGameState,
  fetchParticipants,
  addParticipant,
  deleteParticipant,
  regenerateParticipantLink,
  forceDraw,
  ApiError,
} from "./lib/api";

function seedValidSession(): void {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  localStorage.setItem(
    "ss_admin_session",
    JSON.stringify({ token: fakeToken(exp), expiresAt: exp * 1000 }),
  );
}

function seedExpiredSession(): void {
  localStorage.setItem(
    "ss_admin_session",
    JSON.stringify({ token: fakeToken(1), expiresAt: 1000 }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(fetchGameState).mockResolvedValue(GAME_STATE);
  vi.mocked(fetchParticipants).mockResolvedValue(PARTICIPANTS);
});

describe("App admin gate", () => {
  it("shows the login form when no session exists", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Console admin" })).toBeInTheDocument();
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("shows the overview when a valid session is stored", async () => {
    seedValidSession();
    render(<App />);
    const summaryEl = await summary();
    expect(summaryEl).toHaveTextContent("1 ont tiré, 3 restent (4 participants au total)");
    expect(screen.getByText(/Alice — a tiré/)).toBeInTheDocument();
    expect(screen.getByText(/Bob — reste/)).toBeInTheDocument();
    expect(screen.getByText(/Alice offre à Bob/)).toBeInTheDocument();
  });

  it("ignores an expired stored session and shows the login form", () => {
    seedExpiredSession();
    render(<App />);
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    expect(vi.mocked(fetchGameState)).not.toHaveBeenCalled();
    expect(localStorage.getItem("ss_admin_session")).toBeNull();
  });

  it("logs in, stores the session and shows the overview", async () => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(adminLogin).mockResolvedValue({ token: fakeToken(exp), expiresAt: exp * 1000 });
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Mot de passe"), "p4ss");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await summary()).toHaveTextContent("1 ont tiré, 3 restent");
    expect(adminLogin).toHaveBeenCalledWith("p4ss");
    const stored = JSON.parse(localStorage.getItem("ss_admin_session") ?? "");
    expect(stored.expiresAt).toBe(exp * 1000);
  });

  it("shows the error and stays on the login form on a wrong password", async () => {
    vi.mocked(adminLogin).mockRejectedValue(new ApiError("mot de passe invalide", 401));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText("Mot de passe"), "nope");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("mot de passe invalide");
    expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
  });

  it("logs out back to the login form", async () => {
    seedValidSession();
    const user = userEvent.setup();
    render(<App />);
    await summary();

    await user.click(screen.getByRole("button", { name: "Déconnexion" }));

    expect(await screen.findByLabelText("Mot de passe")).toBeInTheDocument();
    expect(localStorage.getItem("ss_admin_session")).toBeNull();
  });

  it("logs out automatically when the server rejects the stored session", async () => {
    seedValidSession();
    vi.mocked(fetchGameState).mockRejectedValue(new ApiError("session invalide", 401));
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    });
  });
});

describe("App participant management", () => {
  function seedAndRender() {
    seedValidSession();
    return render(<App />);
  }

  async function showParticipants() {
    seedAndRender();
    const section = await screen.findByText("Participants");
    await waitFor(() => {
      expect(vi.mocked(fetchParticipants)).toHaveBeenCalled();
    });
    return section.closest("section");
  }

  it("lists participants with copy/regenerate/delete actions", async () => {
    const section = (await showParticipants())!;
    expect(within(section).getByText(/Alice/)).toBeInTheDocument();
    expect(within(section).getByText(/Bob/)).toBeInTheDocument();
    expect(within(section).getAllByRole("button", { name: "Copier le lien" })).toHaveLength(2);
    expect(within(section).getAllByRole("button", { name: "Régénérer le lien" })).toHaveLength(2);
    expect(within(section).getAllByRole("button", { name: "Supprimer" })).toHaveLength(2);
  });

  it("copies a link on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText, readText: vi.fn() },
    });
    try {
      const section = (await showParticipants())!;
      const buttons = within(section).getAllByRole("button", { name: "Copier le lien" });
      fireEvent.click(buttons[0]);
      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(PARTICIPANTS[0].link);
      });
    } finally {
      if (clipboard) {
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard.value });
      }
    }
  });

  it("adds a participant and refreshes the list", async () => {
    const created = {
      id: "p3",
      name: "Carol",
      link: "33333333-3333-4333-8333-333333333333",
      has_drawn: false,
    };
    vi.mocked(addParticipant).mockResolvedValue(created);
    const user = userEvent.setup();
    await showParticipants();

    await user.type(screen.getByPlaceholderText("Ajouter un participant"), "Carol");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    await waitFor(() => {
      expect(vi.mocked(addParticipant)).toHaveBeenCalledWith(expect.anything(), "Carol");
    });
    await waitFor(() => {
      expect(vi.mocked(fetchParticipants)).toHaveBeenCalledTimes(2);
    });
  });

  it("regenerates a link", async () => {
    const renewed = { ...PARTICIPANTS[1], link: "99999999-9999-4999-8999-999999999999" };
    vi.mocked(regenerateParticipantLink).mockResolvedValue(renewed);
    const user = userEvent.setup();
    await showParticipants();

    await user.click(screen.getAllByRole("button", { name: "Régénérer le lien" })[1]);

    await waitFor(() => {
      expect(vi.mocked(regenerateParticipantLink)).toHaveBeenCalledWith(expect.anything(), "p2");
    });
  });

  it("deletes a participant after confirmation", async () => {
    vi.mocked(deleteParticipant).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    await showParticipants();

    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    await waitFor(() => {
      expect(deleteParticipant).toHaveBeenCalledWith(expect.anything(), "p1");
    });
    confirm.mockRestore();
  });

  it("does not delete when the confirmation is refused", async () => {
    vi.mocked(deleteParticipant).mockResolvedValue(undefined);
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await showParticipants();

    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);

    expect(vi.mocked(deleteParticipant)).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("logs out when the participants fetch rejects the session", async () => {
    vi.mocked(fetchParticipants).mockRejectedValue(new ApiError("session invalide", 401));
    seedAndRender();
    await waitFor(() => {
      expect(screen.getByLabelText("Mot de passe")).toBeInTheDocument();
    });
  });
});

describe("App force draw", () => {
  function seedAndRender() {
    seedValidSession();
    return render(<App />);
  }

  async function showOverview() {
    seedAndRender();
    await summary();
  }

  it("shows a forced badge on a forced attribution", async () => {
    vi.mocked(fetchGameState).mockResolvedValue({
      ...GAME_STATE,
      attributions: [{ giver: "Alice", target: "Bob", forced: true }],
    });
    await showOverview();
    expect(screen.getByText(/tirage forcé/)).toBeInTheDocument();
    expect(
      screen.getByText(/Alice a tiré Bob \(son couple\)/),
    ).toBeInTheDocument();
  });

  it("does not show a forced badge on a normal attribution", async () => {
    await showOverview();
    expect(screen.queryByText(/tirage forcé/)).not.toBeInTheDocument();
  });

  it("forces a draw between the chosen giver and target", async () => {
    vi.mocked(forceDraw).mockResolvedValue({ giver_id: "ids-bob", target_id: "ids-alice" });
    const user = userEvent.setup();
    await showOverview();

    expect(screen.getByText("Forcer un tirage")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Tireur"), "ids-bob");
    await user.selectOptions(screen.getByLabelText("Cible"), "ids-alice");
    await user.click(screen.getByRole("button", { name: "Forcer le tirage" }));

    await waitFor(() => {
      expect(vi.mocked(forceDraw)).toHaveBeenCalledWith(
        expect.anything(),
        "ids-bob",
        "ids-alice",
      );
    });
  });

  it("only lists undrawn participants as possible givers", async () => {
    await showOverview();
    const giverSelect = screen.getByLabelText("Tireur") as HTMLSelectElement;
    const options = Array.from(giverSelect.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).not.toContain("Alice");
    expect(options).toContain("Bob");
    expect(options).toContain("Carol");
    expect(options).toContain("Dave");
  });

  it("shows the server error when the force is rejected", async () => {
    vi.mocked(forceDraw).mockRejectedValue(new ApiError("pas un couple", 502));
    const user = userEvent.setup();
    await showOverview();

    await user.selectOptions(screen.getByLabelText("Tireur"), "ids-bob");
    await user.selectOptions(screen.getByLabelText("Cible"), "ids-alice");
    await user.click(screen.getByRole("button", { name: "Forcer le tirage" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("pas un couple");
  });
});