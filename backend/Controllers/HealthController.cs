using Microsoft.AspNetCore.Mvc;

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
}
