import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fakeToken, GAME_STATE, PARTICIPANTS, PARTICIPANT_LINK } from "./test/helpers";

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
    fetchCouples: vi.fn(),
    addParticipant: vi.fn(),
    deleteParticipant: vi.fn(),
    regenerateParticipantLink: vi.fn(),
    forceDraw: vi.fn(),
    cancelAttribution: vi.fn(),
    resetGame: vi.fn(),
    addCouple: vi.fn(),
    deleteCouple: vi.fn(),
    participantAccess: vi.fn(),
    fetchParticipantView: vi.fn(),
    drawParticipant: vi.fn(),
  };
});

import {
  adminLogin,
  fetchGameState,
  fetchParticipants,
  fetchCouples,
  addParticipant,
  deleteParticipant,
  regenerateParticipantLink,
  forceDraw,
  cancelAttribution,
  resetGame,
  addCouple,
  deleteCouple,
  participantAccess,
  fetchParticipantView,
  drawParticipant,
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

const PARTICIPANT_VIEW = Object.freeze({
  id: "p1",
  name: "Alice",
  has_drawn: true,
  target_name: "Bob",
});

function seedParticipantSession(): void {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  localStorage.setItem(
    "ss_participant_session",
    JSON.stringify({ token: fakeToken(exp, { role: "participant" }), expiresAt: exp * 1000 }),
  );
}

function setSearch(search: string): () => void {
  const restored = new URL(window.location.href);
  window.history.pushState(null, "", `/${search}`);
  return () => {
    window.history.replaceState(null, "", restored.pathname);
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(fetchGameState).mockResolvedValue(GAME_STATE);
  vi.mocked(fetchParticipants).mockResolvedValue(PARTICIPANTS);
  vi.mocked(fetchCouples).mockResolvedValue([]);
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
        expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?link=${PARTICIPANTS[0].link}`);
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

describe("App couples", () => {
  function seedAndRender() {
    seedValidSession();
    return render(<App />);
  }

  async function showCouples() {
    seedAndRender();
    const section = await screen.findByText("Couples");
    await waitFor(() => {
      expect(vi.mocked(fetchCouples)).toHaveBeenCalled();
    });
    return section.closest("section");
  }

  it("lists existing couples", async () => {
    vi.mocked(fetchCouples).mockResolvedValue([
      { participant_a_id: "p1", participant_b_id: "p2", a_name: "Alice", b_name: "Bob" },
    ]);
    const section = (await showCouples())!;
    expect(within(section).getByText(/Alice ne peut pas tirer Bob/)).toBeInTheDocument();
  });

  it("adds a couple and refreshes the list", async () => {
    const user = userEvent.setup();
    await showCouples();
    await user.selectOptions(screen.getByLabelText("Participant A"), "ids-bob");
    await user.selectOptions(screen.getByLabelText("Participant B"), "ids-carol");
    await user.click(screen.getByRole("button", { name: "Ajouter le couple" }));
    await waitFor(() => {
      expect(vi.mocked(addCouple)).toHaveBeenCalledWith(expect.anything(), "ids-bob", "ids-carol");
    });
    await waitFor(() => {
      expect(vi.mocked(fetchCouples)).toHaveBeenCalledTimes(2);
    });
  });

  it("removes a couple", async () => {
    vi.mocked(fetchCouples).mockResolvedValue([
      { participant_a_id: "ids-alice", participant_b_id: "ids-bob", a_name: "Alice", b_name: "Bob" },
    ]);
    const user = userEvent.setup();
    const section = (await showCouples())!;
    await user.click(within(section).getByRole("button", { name: "Retirer" }));
    await waitFor(() => {
      expect(vi.mocked(deleteCouple)).toHaveBeenCalledWith(expect.anything(), "ids-alice", "ids-bob");
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
      attributions: [
        { giver_id: "ids-alice", target_id: "ids-bob", giver: "Alice", target: "Bob", forced: true },
      ],
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

describe("App cancel attribution", () => {
  function seedAndRender() {
    seedValidSession();
    return render(<App />);
  }

  async function showOverview() {
    seedAndRender();
    await summary();
  }

  it("cancels an attribution after confirmation", async () => {
    vi.mocked(cancelAttribution).mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await showOverview();

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    await waitFor(() => {
      expect(vi.mocked(cancelAttribution)).toHaveBeenCalledWith(
        expect.anything(),
        "ids-alice",
      );
    });
    confirm.mockRestore();
  });

  it("does not cancel when the confirmation is refused", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await showOverview();

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(vi.mocked(cancelAttribution)).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows the solvability error when the cancel is rejected", async () => {
    vi.mocked(cancelAttribution).mockRejectedValue(
      new ApiError("l'annulation rendrait la partie insolvable", 422),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await showOverview();

    await user.click(screen.getByRole("button", { name: "Annuler" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("insolvable");
    confirm.mockRestore();
  });
});

describe("App reset game", () => {
  function seedAndRender() {
    seedValidSession();
    return render(<App />);
  }

  async function showOverview() {
    seedAndRender();
    await summary();
  }

  it("resets the game after confirmation and refreshes the state", async () => {
    vi.mocked(resetGame).mockResolvedValue(undefined);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await showOverview();

    await user.click(screen.getByRole("button", { name: "Nouvelle partie" }));

    await waitFor(() => {
      expect(vi.mocked(resetGame)).toHaveBeenCalled();
    });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Nouvelle partie"));
    await waitFor(() => {
      expect(vi.mocked(fetchGameState)).toHaveBeenCalledTimes(2);
    });
    confirm.mockRestore();
  });

  it("does not reset when the confirmation is refused", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    await showOverview();

    await user.click(screen.getByRole("button", { name: "Nouvelle partie" }));

    expect(vi.mocked(resetGame)).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("shows the server error when the reset fails", async () => {
    vi.mocked(resetGame).mockRejectedValue(new ApiError("base injoignable", 502));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    await showOverview();

    await user.click(screen.getByRole("button", { name: "Nouvelle partie" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("base injoignable");
    confirm.mockRestore();
  });
});

describe("App participant draw", () => {
  function seedTokens() {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(participantAccess).mockResolvedValue({
      token: fakeToken(exp, { role: "participant" }),
      expiresAt: exp * 1000,
    });
  }

  const UNDRAWN = Object.freeze({
    id: "p2",
    name: "Bob",
    has_drawn: false,
    target_name: null,
  });

  function seedUndrawn() {
    vi.mocked(fetchParticipantView).mockResolvedValue(UNDRAWN);
  }

  it("offers a clear draw button while the participant is undrawn", async () => {
    seedTokens();
    seedUndrawn();
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);
      expect(await screen.findByText(/pas encore tiré/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Tirer" })).toBeInTheDocument();
      expect(screen.queryByText(/offres à/)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("draws on click and immediately shows who the participant offers to", async () => {
    seedTokens();
    seedUndrawn();
    vi.mocked(drawParticipant).mockResolvedValue({
      id: "p2",
      name: "Bob",
      has_drawn: true,
      target_name: "Carol",
    });
    const user = userEvent.setup();
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);
      await screen.findByRole("button", { name: "Tirer" });
      await user.click(screen.getByRole("button", { name: "Tirer" }));

      expect(await screen.findByText(/offres à/)).toBeInTheDocument();
      expect(screen.getByText("Carol")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Tirer" })).not.toBeInTheDocument();
      expect(vi.mocked(drawParticipant)).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  it("keeps the draw button on a reload after drawing: the view is authoritative", async () => {
    seedTokens();
    vi.mocked(fetchParticipantView).mockResolvedValue({
      id: "p2",
      name: "Bob",
      has_drawn: true,
      target_name: "Carol",
    });
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);
      expect(await screen.findByText(/offres à/)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Tirer" })).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("shows the server message when the draw is refused and stays undrawn", async () => {
    seedTokens();
    seedUndrawn();
    vi.mocked(drawParticipant).mockRejectedValue(new ApiError("aucune cible valide", 422));
    const user = userEvent.setup();
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);
      await screen.findByRole("button", { name: "Tirer" });
      await user.click(screen.getByRole("button", { name: "Tirer" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("aucune cible valide");
      expect(screen.getByRole("button", { name: "Tirer" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("revokes the session when the draw rejects it", async () => {
    seedTokens();
    seedUndrawn();
    vi.mocked(drawParticipant).mockRejectedValue(new ApiError("lien invalide", 401));
    const user = userEvent.setup();
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);
      await screen.findByRole("button", { name: "Tirer" });
      await user.click(screen.getByRole("button", { name: "Tirer" }));

      expect(await screen.findByRole("alert")).toHaveTextContent("Ce lien n'est plus valide");
      await waitFor(() => {
        expect(localStorage.getItem("ss_participant_session")).toBeNull();
      });
    } finally {
      restore();
    }
  });
});

describe("App participant access by link", () => {
  function seedTokens() {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    vi.mocked(participantAccess).mockResolvedValue({
      token: fakeToken(exp, { role: "participant" }),
      expiresAt: exp * 1000,
    });
  }

  it("opens a private link from the URL, identifies the participant and shows their view", async () => {
    seedTokens();
    vi.mocked(fetchParticipantView).mockResolvedValue(PARTICIPANT_VIEW);
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);

      expect(await screen.findByText("Alice")).toBeInTheDocument();
      expect(screen.getByText(/offres à/)).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(participantAccess).toHaveBeenCalledWith(PARTICIPANT_LINK);
      await waitFor(() => {
        expect(window.location.search).toBe("");
      });
      const stored = JSON.parse(localStorage.getItem("ss_participant_session") ?? "");
      expect(stored.token).toBeDefined();
    } finally {
      restore();
    }
  });

  it("does not leak other attributions in the participant view", async () => {
    seedTokens();
    vi.mocked(fetchParticipantView).mockResolvedValue({
      ...PARTICIPANT_VIEW,
      name: "Carol",
      target_name: "Dave",
    });
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);

      await screen.findByText("Carol");
      expect(screen.getByText("Dave")).toBeInTheDocument();
      expect(screen.queryByText("Bob")).not.toBeInTheDocument();
      expect(screen.queryByText("Alice offre à")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Console admin" })).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("shows a hint when the participant has not drawn yet", async () => {
    seedTokens();
    vi.mocked(fetchParticipantView).mockResolvedValue({
      id: "p2",
      name: "Bob",
      has_drawn: false,
      target_name: null,
    });
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);

      expect(await screen.findByText(/pas encore tiré/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it("keeps the session after reload: the stored session is reused", async () => {
    seedParticipantSession();
    vi.mocked(fetchParticipantView).mockResolvedValue(PARTICIPANT_VIEW);
    render(<App />);

    await screen.findByText("Alice");
    expect(participantAccess).not.toHaveBeenCalled();
    expect(fetchParticipantView).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("ss_participant_session")).not.toBeNull();
  });

  it("revokes a stored session when the link has been regenerated", async () => {
    seedParticipantSession();
    vi.mocked(fetchParticipantView).mockRejectedValue(new ApiError("lien invalide", 401));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Ce lien n'est plus valide : il a peut-être été régénéré.",
    );
    expect(screen.getByText(/Demande un nouveau lien/)).toBeInTheDocument();
    await waitFor(() => {
      expect(localStorage.getItem("ss_participant_session")).toBeNull();
    });
  });

  it("does not advise asking for a new link on a transient failure", async () => {
    seedParticipantSession();
    vi.mocked(fetchParticipantView).mockRejectedValue(new ApiError("base injoignable", 502));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("base injoignable");
    expect(screen.queryByText(/Demande un nouveau lien/)).not.toBeInTheDocument();
  });

  it("rejects an unknown link and does not store a session", async () => {
    vi.mocked(participantAccess).mockRejectedValue(new ApiError("lien inconnu", 401));
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);

      expect(await screen.findByRole("alert")).toHaveTextContent("lien inconnu");
      expect(localStorage.getItem("ss_participant_session")).toBeNull();
    } finally {
      restore();
    }
  });

  it("closes the participant session back to the entry screen", async () => {
    seedTokens();
    vi.mocked(fetchParticipantView).mockResolvedValue(PARTICIPANT_VIEW);
    const user = userEvent.setup();
    const restore = setSearch(`?link=${PARTICIPANT_LINK}`);
    try {
      render(<App />);
      await screen.findByText("Alice");

      await user.click(screen.getByRole("button", { name: "Fermer ma session" }));

      expect(await screen.findByLabelText("Mot de passe")).toBeInTheDocument();
      expect(localStorage.getItem("ss_participant_session")).toBeNull();
    } finally {
      restore();
    }
  });
});