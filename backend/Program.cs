using Microsoft.Extensions.FileProviders;
using TrailBuddy.Api.Data;

LoadRepoRootEnvIntoEnvironment();

var builder = WebApplication.CreateBuilder(args);

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

app.MapControllers();

app.Run();

static void LoadRepoRootEnvIntoEnvironment()
{
    var backendDir = Directory.GetCurrentDirectory();
    var path = Path.GetFullPath(Path.Combine(backendDir, "..", ".env"));
    if (!File.Exists(path))
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

        if (string.Equals(key, "Connection_String", StringComparison.OrdinalIgnoreCase))
            Environment.SetEnvironmentVariable("ConnectionStrings__Default", value);
        else
            Environment.SetEnvironmentVariable(key, value);
    }
}
