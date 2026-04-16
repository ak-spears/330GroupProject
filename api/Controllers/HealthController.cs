using Microsoft.AspNetCore.Mvc;
using MySqlConnector;

namespace TrailBuddy.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    /// <summary>
    /// Smoke-test endpoint for frontend ↔ API wiring.
    /// </summary>
    [HttpGet]
    public IActionResult Get()
    {
        return Ok(new { status = "ok" });
    }

    /// <summary>
    /// Verifies <c>ConnectionStrings:Default</c> (from .env <c>Connection_String</c>) can reach MySQL.
    /// </summary>
    [HttpGet("database")]
    public async Task<IActionResult> Database([FromServices] IConfiguration configuration, CancellationToken cancellationToken)
    {
        var connectionString = configuration.GetConnectionString("Default");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                status = "error",
                database = false,
                message = "ConnectionStrings:Default is not set. Add Connection_String to the repo root .env file."
            });
        }

        try
        {
            await using var connection = new MySqlConnection(connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new MySqlCommand("SELECT 1;", connection);
            await command.ExecuteScalarAsync(cancellationToken);
            return Ok(new { status = "ok", database = true });
        }
        catch (MySqlException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                status = "error",
                database = false,
                message = ex.Message
            });
        }
    }
}
