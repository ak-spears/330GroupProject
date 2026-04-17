using MySqlConnector;

namespace TrailBuddy.Api.Data;

/// <summary>
/// Opens <see cref="MySqlConnection"/> instances using the configured connection string
/// (<c>ConnectionStrings:Default</c>, populated from repo <c>.env</c> <c>Connection_String</c> if present).
/// </summary>
public sealed class MySqlConnectionFactory
{
    private readonly string _connectionString;

    public MySqlConnectionFactory(IConfiguration configuration)
    {
        var raw = configuration.GetConnectionString("Default")
            ?? throw new InvalidOperationException(
                "ConnectionStrings:Default is not configured. Set Connection_String in the repo root .env file or ConnectionStrings:Default in appsettings / user secrets.");

        // RDS / legacy schemas may contain 0000-00-00 dates; default MySqlConnector throws on read.
        var builder = new MySqlConnectionStringBuilder(raw)
        {
            ConvertZeroDateTime = true,
            AllowZeroDateTime = true
        };
        _connectionString = builder.ConnectionString;
    }

    public MySqlConnection CreateConnection() => new(_connectionString);
}
