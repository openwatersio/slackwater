import Testing
import SlackwaterKit

private struct Recipe: Decodable { let basis: [String]; let days: Int; let sampleMinutes: Int }

@Test func chsTideFitMatchesTheSharedRecipe() throws {
    let recipe = try loadFixture("chs-tide-fit", as: Recipe.self)
    #expect(ChsTideFit.basis == recipe.basis)
    #expect(ChsTideFit.days == recipe.days)
    #expect(ChsTideFit.sampleMinutes == recipe.sampleMinutes)
}
