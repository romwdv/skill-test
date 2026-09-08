import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { fakeToken, GAME_STATE } from "./test/helpers";

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
  };
});

import { adminLogin, fetchGameState, ApiError } from "./lib/api";

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