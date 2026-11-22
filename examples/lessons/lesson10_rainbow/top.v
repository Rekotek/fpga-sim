// Урок 10, практика 2: радуга. Оттенок hue (0..255) растёт по таймеру,
// формула «колеса цветов» превращает его в R, G, B: красный → зелёный →
// синий → снова красный. Полный круг — 256 шагов, 64 шага в секунду: 4 с.
module top #(
    parameter integer CLK_HZ  = 27_000_000, // частота clk
    parameter integer STEP_HZ = 64          // шагов оттенка в секунду; тестбенч ставит больше
) (
    input  wire clk,            // 27 МГц, вывод 4
    output wire ws2812          // линия данных WS2812, вывод 79
);
    // ---------- Таймер шагов: тик 64 раза в секунду ----------
    localparam integer STEP_LAST = CLK_HZ / STEP_HZ - 1;    // 421 874 → 19 бит
    reg  [18:0] div = 19'd0;
    wire        tick = (div == STEP_LAST);

    always @(posedge clk) begin
        if (tick) div <= 19'd0;
        else      div <= div + 1'b1;
    end

    reg [7:0] hue = 8'd0;               // оттенок: 0 — красный, 85 — зелёный, 170 — синий

    always @(posedge clk)
        if (tick) hue <= hue + 1'b1;    // 255 → 0: по кругу

    // ---------- Колесо цветов: три отрезка по 85 шагов ----------
    reg [7:0] h;                        // НЕ регистр: шаг внутри отрезка 0..85
    reg [7:0] r_full, g_full, b_full;   // НЕ регистры: цвет на полной яркости

    always @(*) begin
        h = 8'd0;  r_full = 8'd0;  g_full = 8'd0;  b_full = 8'd0;
        if (hue < 8'd85) begin                  // красный → зелёный
            h      = hue;
            r_full = 8'd255 - h * 8'd3;
            g_full = h * 8'd3;
        end else if (hue < 8'd170) begin        // зелёный → синий
            h      = hue - 8'd85;
            g_full = 8'd255 - h * 8'd3;
            b_full = h * 8'd3;
        end else begin                          // синий → красный
            h      = hue - 8'd170;
            b_full = 8'd255 - h * 8'd3;
            r_full = h * 8'd3;
        end
    end

    // Яркость: делим на 4 сдвигом (не больше 63 из 255). ⚠️ Проверить на плате.
    ws2812_tx #(.CLK_HZ(CLK_HZ)) led0 (
        .clk   (clk),
        .start (1'b1),
        .r     (r_full >> 2),
        .g     (g_full >> 2),
        .b     (b_full >> 2),
        .dout  (ws2812),
        .busy  ()
    );
endmodule
