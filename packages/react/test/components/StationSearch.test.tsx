import { afterEach, describe, expect, test, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StationSearch } from "../../src/components/StationSearch.js";
import { createTestWrapper } from "../helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderSearch(props: Partial<Parameters<typeof StationSearch>[0]> = {}) {
  const onSelect = vi.fn();
  render(<StationSearch onSelect={onSelect} {...props} />, { wrapper: createTestWrapper() });
  return { onSelect, field: screen.getByRole("searchbox"), user: userEvent.setup() };
}

async function results() {
  const list = await screen.findByRole("list", undefined, { timeout: 10000 });
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.querySelector(".truncate")!.textContent);
}

const chip = (name: string) => screen.getByRole("button", { name });

describe("StationSearch", () => {
  test("asks for a harbor, bay, or channel, or the caller's placeholder", () => {
    const { field } = renderSearch();
    expect(field.getAttribute("placeholder")).toBe("Harbor, bay, or channel");
    expect(screen.getByRole("search")).toBeDefined();
  });

  test("takes a custom placeholder", () => {
    const { field } = renderSearch({ placeholder: "Find a station" });
    expect(field.getAttribute("placeholder")).toBe("Find a station");
  });

  test("finds tide and current stations together", async () => {
    const { field, user } = renderSearch();
    await user.type(field, "Deception");

    expect(await results()).toEqual([
      "Deception Pass St. Park",
      "Point Deception",
      "Deception Pass (Narrows)",
      "Yokeko Point",
      "Cornet Bay",
      "Yokeko Point",
    ]);
    expect(screen.getByRole("status").textContent).toBe("6 stations");
    expect(screen.queryByText(/nm$/)).toBeNull();
  });

  test("says which kind was picked", async () => {
    const { field, user, onSelect } = renderSearch();
    await user.type(field, "Deception");
    await results();

    await user.click(screen.getByRole("button", { name: /^Deception Pass \(Narrows\)/ }));
    expect(onSelect.mock.calls[0][0]).toMatchObject({ id: "noaa/PUG1701", kind: "current" });
  });

  test("filters to tides or currents, and the active filter returns to all", async () => {
    const { field, user } = renderSearch();
    await user.type(field, "Deception");
    await results();
    expect(chip("Show all").getAttribute("aria-pressed")).toBe("true");

    await user.click(chip("Show currents"));
    expect(chip("Show currents").getAttribute("aria-pressed")).toBe("true");
    expect(await results()).toEqual([
      "Point Deception",
      "Deception Pass (Narrows)",
      "Yokeko Point",
    ]);

    await user.click(chip("Show tides"));
    expect(await results()).toEqual(["Deception Pass St. Park", "Yokeko Point", "Cornet Bay"]);

    await user.click(chip("Show tides"));
    expect(chip("Show all").getAttribute("aria-pressed")).toBe("true");
    expect((await results()).length).toBe(6);
  });

  test("says when nothing matches", async () => {
    const { field, user } = renderSearch();
    await user.type(field, "Xyzzyq");

    const visible = { selector: "p[aria-hidden]" };
    expect(await screen.findByText("No matches", visible, { timeout: 10000 })).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("No matches");
  });

  test("says when it stopped at sixty", async () => {
    const { field, user } = renderSearch();
    await user.type(field, "bay");

    expect((await results()).length).toBe(60);
    expect(screen.getByText("First 60 — keep typing to narrow")).toBeDefined();
  });

  test("doesn't search one letter", async () => {
    const fetch = vi.spyOn(window, "fetch");
    const { field, user } = renderSearch();
    await user.type(field, "b");
    await new Promise((r) => setTimeout(r, 500));

    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).toBeNull();
  });

  test("clears with its button or Escape", async () => {
    const { field, user } = renderSearch();
    expect(screen.queryByRole("button", { name: "Clear search text" })).toBeNull();

    await user.type(field, "Deception");
    await results();
    await user.click(screen.getByRole("button", { name: "Clear search text" }));
    expect((field as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(field);

    await user.type(field, "Boston{Escape}");
    expect((field as HTMLInputElement).value).toBe("");
  });

  test("finds tide stations from an API without the current routes", async () => {
    const real = window.fetch.bind(window);
    vi.spyOn(window, "fetch").mockImplementation((input, init) =>
      String(input).includes("/currents/")
        ? Promise.resolve(new Response(JSON.stringify({ message: "Not found" }), { status: 404 }))
        : real(input, init),
    );
    const { field, user } = renderSearch();
    await user.type(field, "Deception");

    expect(await results()).toEqual(["Deception Pass St. Park", "Yokeko Point", "Cornet Bay"]);
  });

  test("says why when the search fails", async () => {
    vi.spyOn(window, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Down for maintenance" }), { status: 503 }),
    );
    const { field, user } = renderSearch();
    await user.type(field, "Boston");

    expect(await screen.findByText("Down for maintenance")).toBeDefined();
  });
});
