// Урок 9, задание «Яркость с Mac» (ключ): цифры 0..9 с клавиатуры задают
// яркость LED0 (ШИМ из урока 8), LED1..LED4 показывают уровень. Эхо — как в практике 4.
module top #(
    parameter integer CLK_HZ = 27_000_000,  // частота clk; тестбенч ставит меньше
    parameter integer BAUD   = 115_200      // скорость UART; тестбенч ставит меньше
) (
    input  wire       clk,      // 27 МГц, вывод 4
    input  wire       uart_rx,  // UART: от Mac через BL616 к ПЛИС, вывод 70
    output wire       uart_tx,  // UART: от ПЛИС к BL616 и в Mac, вывод 69
    output wire [5:0] led       // LED0..LED5, выводы 15..20, горят при 0
);
    wire [7:0] rx_data;
    wire       rx_valid;

    uart_rx #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) rx0 (
        .clk   (clk),
        .rx    (uart_rx),
        .data  (rx_data),
        .valid (rx_valid)
    );

    uart_tx #(.CLK_HZ(CLK_HZ), .BAUD(BAUD)) tx0 (
        .clk   (clk),
        .start (rx_valid),          // эхо
        .data  (rx_data),
        .tx    (uart_tx),
        .busy  ()
    );

    // Уровень яркости 0..9. Коды цифр "0".."9" — 0x30..0x39:
    // младшие 4 бита кода и есть сама цифра.
    reg [3:0] level = 4'd0;

    always @(posedge clk)
        if (rx_valid && rx_data >= "0" && rx_data <= "9")
            level <= rx_data[3:0];

    wire [7:0] duty = level * 8'd28;        // 0, 28, …, 252 (9 × 28 = 252)

    // ШИМ из урока 8: счётчик + компаратор.
    reg [7:0] cnt = 8'd0;

    always @(posedge clk)
        cnt <= cnt + 1'b1;

    wire pwm = (cnt < duty);

    assign led = ~{1'b0, level, pwm};
endmodule
