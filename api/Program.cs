using Microsoft.Extensions.FileProviders;
using TrailBuddy.Api.Data;

var builder = WebApplication.CreateBuilder(args);

ApplyDotEnvToConfiguration(builder.Configuration, builder.Environment.ContentRootPath);

builder.Services.AddControllers();
builder.Services.AddSingleton<MySqlConnectionFactory>();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin();
        policy.AllowAnyHeader();
        policy.AllowAnyMethod();
    });
});

var app = builder.Build();

// HTTP-only dev runs (e.g. profile `http`) have no HTTPS port → redirection logs a warning and adds no value.
if (!app.Environment.IsDevelopment())
    app.UseHttpsRedirection();

app.UseCors();

var frontendPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "frontend"));
if (Directory.Exists(frontendPath))
{
    var fileProvider = new PhysicalFileProvider(frontendPath);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fileProvider });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = fileProvider });
}

app.UseAuthorization();

// Browsers still request /favicon.ico by default; we only ship favicon.svg in /frontend.
app.MapGet("/favicon.ico", () => Results.Redirect("/favicon.svg", permanent: false));

app.MapControllers();

app.Run();

/// <summary>
/// Loads the first existing .env from known locations and merges into configuration.
/// Fixes IDE/debug runs where <see cref="Directory.GetCurrentDirectory"/> is not the <c>api/</c> folder.
/// </summary>
static void ApplyDotEnvToConfiguration(ConfigurationManager configuration, string contentRoot)
{
    var candidates = new[]
    {
        Path.GetFullPath(Path.Combine(contentRoot, "..", ".env")),
        Path.GetFullPath(Path.Combine(contentRoot, ".env")),
        Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), ".env")),
        Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", ".env"))
    };

    var path = candidates.FirstOrDefault(File.Exists);
    if (path is null)
        return;

    foreach (var rawLine in File.ReadAllLines(path))
    {
        var line = rawLine.Trim();
        if (line.Length == 0 || line.StartsWith('#'))
            continue;

        var separator = line.IndexOf('=');
        if (separator <= 0)
            continue;

        var key = line[..separator].Trim();
        var value = line[(separator + 1)..].Trim();
        if (key.Length == 0)
            continue;

        if (IsDatabaseConnectionKey(key))
            configuration["ConnectionStrings:Default"] = value;
        else
            configuration[key] = value;
    }
}

static bool IsDatabaseConnectionKey(string key) =>
    string.Equals(key, "Connection_String", StringComparison.OrdinalIgnoreCase)
    || string.Equals(key, "CONNECTION_STRING", StringComparison.Ordinal)
    || string.Equals(key, "ConnectionString", StringComparison.OrdinalIgnoreCase);
